/**
 * Тесты IpcClient: конфигурация и вызов request через фейковый TCP-сервер и канал окна.
 */
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { IpcClient, type IpcClientConfig } from "../src/ipcClient.js";

describe("IpcClient", () => {
	describe("constructor", () => {
		it("использует переданную конфигурацию", () => {
			const config: IpcClientConfig = {
				host: "10.0.0.1",
				port: 9999,
				token: "secret",
				timeoutMs: 1000,
			};
			const client = new IpcClient(config);
			assert.ok(client instanceof IpcClient);
		});

		it("принимает частичную конфигурацию (порт по умолчанию 40241)", () => {
			const client = new IpcClient({ host: "127.0.0.1" });
			assert.ok(client instanceof IpcClient);
		});
	});

	describe("request (с фейковым TCP-сервером)", () => {
		let server: net.Server;
		let serverPort: number;

		before(() => {
			return new Promise<void>((resolve) => {
				server = net.createServer((socket) => {
					socket.on("data", (data: Buffer) => {
						const payload = JSON.stringify({
							id: null,
							result: { value: 42 },
						});
						socket.write(payload + "\n");
						socket.end();
					});
				});
				server.listen(0, "127.0.0.1", () => {
					const addr = server.address();
					serverPort = typeof addr === "object" && addr?.port ? addr.port : 0;
					resolve();
				});
			});
		});

		after(() => {
			return new Promise<void>((resolve) => {
				server.close(() => resolve());
			});
		});

		it("возвращает result из ответа сервера", async () => {
			const client = new IpcClient({
				host: "127.0.0.1",
				port: serverPort,
				timeoutMs: 5000,
			});
			const result = await client.request<{ value: number }>("test", {});
			assert.strictEqual(result?.value, 42);
		});
	});

	describe("request — кириллица на стыке порций", () => {
		let server: net.Server;
		let serverPort: number;
		const name = "РегистрСведений.ДополнительныеАдресныеСведения";

		before(() => {
			return new Promise<void>((resolve) => {
				server = net.createServer((socket) => {
					socket.on("data", () => {
						const bytes = Buffer.from(`${JSON.stringify({ id: null, result: { name } })}\n`, "utf8");
						// Рвём ответ посреди двухбайтовой буквы: так его бывает режет сокет
						const cut = bytes.indexOf(Buffer.from("н", "utf8")) + 1;
						socket.write(bytes.subarray(0, cut));
						setTimeout(() => {
							socket.write(bytes.subarray(cut));
							socket.end();
						}, 20);
					});
				});
				server.listen(0, "127.0.0.1", () => {
					const addr = server.address();
					serverPort = typeof addr === "object" && addr?.port ? addr.port : 0;
					resolve();
				});
			});
		});

		after(() => {
			return new Promise<void>((resolve) => {
				server.close(() => resolve());
			});
		});

		it("буква, разорванная между порциями, не портится", async () => {
			const client = new IpcClient({ host: "127.0.0.1", port: serverPort, timeoutMs: 5000 });
			const result = await client.request<{ name: string }>("test", {});
			assert.strictEqual(result?.name, name);
		});
	});

	describe("request — ответ с error", () => {
		let server: net.Server;
		let serverPort: number;

		before(() => {
			return new Promise<void>((resolve) => {
				server = net.createServer((socket) => {
					socket.on("data", () => {
						const payload = JSON.stringify({
							id: null,
							error: { message: "Ошибка сервера", code: "ERR" },
						});
						socket.write(payload + "\n");
						socket.end();
					});
				});
				server.listen(0, "127.0.0.1", () => {
					const addr = server.address();
					serverPort = typeof addr === "object" && addr?.port ? addr.port : 0;
					resolve();
				});
			});
		});

		after(() => {
			return new Promise<void>((resolve) => {
				server.close(() => resolve());
			});
		});

		it("отклоняет промис с сообщением и кодом ошибки", async () => {
			const client = new IpcClient({
				host: "127.0.0.1",
				port: serverPort,
				timeoutMs: 5000,
			});
			await assert.rejects(
				async () => client.request("test"),
				(err: Error) => err.message.includes("Ошибка сервера") && err.message.includes("ERR")
			);
		});
	});

	describe("executeCommand и listCommands (через фейковый сервер)", () => {
		let server: net.Server;
		let serverPort: number;

		before(() => {
			return new Promise<void>((resolve) => {
				server = net.createServer((socket) => {
					socket.on("data", (data: Buffer) => {
						const req = JSON.parse(data.toString().split("\n")[0]);
						const method = req.method;
						const id = req.id;
						let result: unknown;
						if (method === "listCommands") {
							result = { commands: ["cmd.a", "cmd.b"] };
						} else if (method === "executeCommand") {
							result = { ok: true, commandResult: "done" };
						} else {
							result = null;
						}
						socket.write(JSON.stringify({ id, result }) + "\n");
						socket.end();
					});
				});
				server.listen(0, "127.0.0.1", () => {
					const addr = server.address();
					serverPort = typeof addr === "object" && addr?.port ? addr.port : 0;
					resolve();
				});
			});
		});

		after(() => {
			return new Promise<void>((resolve) => {
				server.close(() => resolve());
			});
		});

		it("listCommands возвращает массив command ID", async () => {
			const client = new IpcClient({
				host: "127.0.0.1",
				port: serverPort,
				timeoutMs: 5000,
			});
			const commands = await client.listCommands();
			assert.deepStrictEqual(commands, ["cmd.a", "cmd.b"]);
		});

		it("executeCommand возвращает commandResult при ok: true", async () => {
			const client = new IpcClient({
				host: "127.0.0.1",
				port: serverPort,
				timeoutMs: 5000,
			});
			const result = await client.executeCommand("cmd.a", [], "/path");
			assert.strictEqual(result, "done");
		});

		it("executeCommand принимает явный timeoutMs", async () => {
			const client = new IpcClient({
				host: "127.0.0.1",
				port: serverPort,
				timeoutMs: 5000,
			});
			// Увеличенный таймаут для wait-сценария — команда должна выполниться штатно
			const result = await client.executeCommand("cmd.a", [{ wait: true }], "/path", 300_000);
			assert.strictEqual(result, "done");
		});
	});

	describe("executeCommand — ok: false", () => {
		let server: net.Server;
		let serverPort: number;

		before(() => {
			return new Promise<void>((resolve) => {
				server = net.createServer((socket) => {
					socket.on("data", (data: Buffer) => {
						const req = JSON.parse(data.toString().split("\n")[0]);
						const payload = JSON.stringify({
							id: req.id,
							result: {
								ok: false,
								message: "Команда не выполнена",
							},
						});
						socket.write(payload + "\n");
						socket.end();
					});
				});
				server.listen(0, "127.0.0.1", () => {
					const addr = server.address();
					serverPort = typeof addr === "object" && addr?.port ? addr.port : 0;
					resolve();
				});
			});
		});

		after(() => {
			return new Promise<void>((resolve) => {
				server.close(() => resolve());
			});
		});

		it("выбрасывает Error с сообщением сервера", async () => {
			const client = new IpcClient({
				host: "127.0.0.1",
				port: serverPort,
				timeoutMs: 5000,
			});
			await assert.rejects(
				async () => client.executeCommand("x", [], "/p"),
				(err: Error) => err.message === "Команда не выполнена"
			);
		});
	});
});

describe("request — подробности ошибки", () => {
	let server: net.Server;
	let serverPort: number;

	before(() => {
		return new Promise<void>((resolve) => {
			server = net.createServer((socket) => {
				socket.on("data", () => {
					socket.write(
						JSON.stringify({
							id: null,
							error: {
								message: "Путь projectPath не совпадает с текущей рабочей областью VS Code",
								code: "WORKSPACE_MISMATCH",
								details: { projectPath: "C:/wrong", workspaceRoots: ["C:/work/erp"] },
							},
						}) + "\n"
					);
					socket.end();
				});
			});
			server.listen(0, "127.0.0.1", () => {
				const addr = server.address();
				serverPort = typeof addr === "object" && addr?.port ? addr.port : 0;
				resolve();
			});
		});
	});

	after(() => {
		return new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("каталоги рабочей области попадают в сообщение", async () => {
		const client = new IpcClient({ host: "127.0.0.1", port: serverPort, token: null, timeoutMs: 2000 });

		await assert.rejects(
			() => client.request("executeCommand"),
			(error: Error) => {
				assert.match(error.message, /WORKSPACE_MISMATCH/);
				assert.match(error.message, /C:\/work\/erp/);
				return true;
			}
		);
	});
});

describe("request — канал окна", () => {
	let server: net.Server;
	let dir: string | undefined;
	let pipe: string;

	before(() => {
		// Так канал окна открывает расширение: именованный канал Windows или Unix-сокет
		if (process.platform === "win32") {
			pipe = `\\\\.\\pipe\\mcp-1c-platform-tools-test-${process.pid}`;
		} else {
			dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-1cpt-"));
			pipe = path.join(dir, "ipc.sock");
		}
		return new Promise<void>((resolve) => {
			server = net.createServer((socket) => {
				socket.on("data", (data: Buffer) => {
					const req = JSON.parse(data.toString().split("\n")[0]);
					socket.end(`${JSON.stringify({ id: req.id, result: { method: req.method, token: req.token } })}\n`);
				});
			});
			server.listen(pipe, () => resolve());
		});
	});

	after(() => {
		return new Promise<void>((resolve) => {
			server.close(() => {
				if (dir) {
					fs.rmSync(dir, { recursive: true, force: true });
				}
				resolve();
			});
		});
	});

	it("с путём канала хост и порт не используются", async () => {
		// Порт 1 никто не слушает: ответ возможен только из канала
		const client = new IpcClient({ pipe, host: "127.0.0.1", port: 1, token: "сессия", timeoutMs: 5000 });
		const result = await client.request<{ method: string; token: string }>("ping");
		assert.deepStrictEqual(result, { method: "ping", token: "сессия" });
	});

	it("путь канала и токен берутся из ONEC_IPC_PIPE и ONEC_IPC_TOKEN", async () => {
		const saved = { pipe: process.env.ONEC_IPC_PIPE, token: process.env.ONEC_IPC_TOKEN };
		process.env.ONEC_IPC_PIPE = pipe;
		process.env.ONEC_IPC_TOKEN = "из окружения";
		try {
			const client = new IpcClient({ timeoutMs: 5000 });
			const result = await client.request<{ method: string; token: string }>("listCommands");
			assert.deepStrictEqual(result, { method: "listCommands", token: "из окружения" });
		} finally {
			for (const [name, value] of [["ONEC_IPC_PIPE", saved.pipe], ["ONEC_IPC_TOKEN", saved.token]] as const) {
				if (value === undefined) {
					delete process.env[name];
				} else {
					process.env[name] = value;
				}
			}
		}
	});
});
