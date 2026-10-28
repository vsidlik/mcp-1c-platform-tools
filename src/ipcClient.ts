/**
 * Клиент канала окна расширения 1c-platform-tools (JSON-RPC over newline-delimited JSON).
 * Канал — именованный канал Windows или Unix-сокет окна, адрес и токен берутся из
 * реестра окон. Используется standalone MCP-процессом для listCommands и executeCommand.
 */
import * as net from "node:net";
import { StringDecoder } from "node:string_decoder";
import { randomUUID } from "node:crypto";
import { logger } from "./loggerServer.js";

/** Команда расширения с заголовком: из неё строится описание инструмента. */
export interface CommandDescriptor {
	/** Идентификатор команды (1c-platform-tools.test.runAll). */
	id: string;
	/** Заголовок команды из package.json расширения. */
	title?: string;
	/** Категория команды из package.json расширения. */
	category?: string;
	/** Команда выполняется синхронно и возвращает результат. */
	supportsWait?: boolean;
}

/** Предел длины подробностей ошибки в сообщении (символов). */
const DETAILS_LIMIT = 500;

/**
 * Дополняет сообщение об ошибке подробностями от расширения.
 *
 * Расширение сообщает, например, какие каталоги открыты в VS Code при
 * несовпадении projectPath: без этого агент не знает, что исправить.
 *
 * @param details — поле details из ответа IPC
 * @returns строка для добавления к сообщению (пустая, если подробностей нет)
 */
function formatErrorDetails(details: unknown): string {
	if (details === undefined || details === null) {
		return "";
	}
	try {
		const text = JSON.stringify(details);
		if (!text || text === "{}" || text === "[]") {
			return "";
		}
		return `. Подробности: ${text.length > DETAILS_LIMIT ? `${text.slice(0, DETAILS_LIMIT)}…` : text}`;
	} catch {
		return "";
	}
}

/** Настройки подключения к каналу окна. */
export interface IpcClientConfig {
	/** Путь именованного канала Windows или Unix-сокета окна. */
	pipe: string;
	/** Токен канала окна. */
	token: string;
	/** Таймаут ответа по умолчанию (мс). */
	timeoutMs?: number;
}

/** Отказ с кодом: текст ошибки для агента собирается из причины, кода и подробностей. */
export class IpcError extends Error {
	/**
	 * @param reason — что случилось и что сделать
	 * @param code — код отказа, например WORKSPACE_MISMATCH
	 * @param details — подробности отказа
	 */
	constructor(
		readonly reason: string,
		readonly code?: string,
		readonly details?: unknown
	) {
		super((code ? `${reason} (код: ${code})` : reason) + formatErrorDetails(details));
		this.name = "IpcError";
	}
}

/** Тело запроса к IPC-серверу. */
interface IpcRequestPayload {
	id: string;
	method: string;
	params?: Record<string, unknown>;
	token?: string;
}

/** Тело ответа IPC-сервера (result или error). */
interface IpcResponsePayload {
	id: string | null;
	result?: unknown;
	error?: {
		message: string;
		code?: string;
		details?: unknown;
	};
}

/**
 * Клиент для вызова методов расширения 1c-platform-tools по каналу окна.
 */
export class IpcClient {
	private readonly timeoutMs: number;

	/**
	 * @param config — путь канала окна, токен и таймаут
	 */
	constructor(private readonly config: IpcClientConfig) {
		this.timeoutMs = config.timeoutMs ?? 60_000;
	}

	/**
	 * Выполняет JSON-RPC запрос к IPC-серверу.
	 *
	 * @param method — имя метода (например listCommands, executeCommand)
	 * @param params — опциональные параметры
	 * @param timeoutMs — таймаут ожидания ответа; если не задан, используется значение из конфига
	 * @returns результат из response.result (при ошибке — reject с сообщением сервера)
	 */
	public async request<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		timeoutMs?: number
	): Promise<T> {
		const id = randomUUID();
		const payload: IpcRequestPayload = {
			id,
			method,
			params,
			token: this.config.token,
		};

		const message = `${JSON.stringify(payload)}\n`;
		const effectiveTimeout = timeoutMs ?? this.timeoutMs;
		logger.debug(`IPC: запрос ${method} (id ${id}) → ${this.config.pipe} (таймаут ${effectiveTimeout} мс)`);

		return new Promise<T>((resolve, reject) => {
			const socket = new net.Socket();
			let buffer = "";
			let finished = false;

			const cleanup = (): void => {
				if (!socket.destroyed) {
					socket.destroy();
				}
			};

			const onError = (error: unknown): void => {
				if (finished) {
					return;
				}
				finished = true;
				cleanup();
				const err =
					error instanceof Error
						? error
						: new Error("Неизвестная ошибка IPC-клиента");
				logger.error(`IPC: подключение ${this.config.pipe} — ${err.message}`);
				reject(
					new Error(
						`Не удалось подключиться к окну 1C: Platform Tools: ${err.message}`
					)
				);
			};

			const timeout = setTimeout(() => {
				if (finished) {
					return;
				}
				finished = true;
				cleanup();
				logger.error(`IPC: таймаут ${effectiveTimeout} мс при вызове ${method}`);
				reject(
					new Error(
						`Таймаут ожидания ответа от расширения 1c-platform-tools по IPC (${effectiveTimeout} мс)`
					)
				);
			}, effectiveTimeout);

			socket.on("error", onError);

			// Декодер держит байты символа, разорванного между порциями: иначе кириллица на стыке портится
			const decoder = new StringDecoder("utf8");
			socket.on("data", (data: Buffer) => {
				if (finished) {
					return;
				}

				buffer += decoder.write(data);
				const index = buffer.indexOf("\n");

				if (index === -1) {
					return;
				}

				const line = buffer.slice(0, index).trim();
				buffer = buffer.slice(index + 1);

				if (line === "") {
					return;
				}

				let response: IpcResponsePayload;
				try {
					response = JSON.parse(line) as IpcResponsePayload;
				} catch (error) {
					finished = true;
					clearTimeout(timeout);
					cleanup();
					const cause =
						error instanceof Error
							? error.message
							: "Некорректный JSON-ответ от IPC-сервера";
					logger.error(`IPC: некорректный ответ — ${cause}`);
					reject(
						new Error(
							`Некорректный ответ от расширения 1c-platform-tools по IPC: ${cause}`
						)
					);
					return;
				}

				if (response.error) {
					finished = true;
					clearTimeout(timeout);
					cleanup();
					const error = new IpcError(
						response.error.message || "Неизвестная ошибка IPC-сервера",
						response.error.code || undefined,
						response.error.details
					);
					logger.error(`IPC: ошибка сервера — ${error.message}`);
					reject(error);
					return;
				}

				finished = true;
				clearTimeout(timeout);
				cleanup();
				resolve(response.result as T);
			});

			socket.connect(this.config.pipe, () => {
				socket.write(message);
			});
		});
	}

	/**
	 * Вызывает команду расширения в контексте указанного проекта.
	 *
	 * @param commandId — идентификатор команды (например 1c-platform-tools.cf.load)
	 * @param args — аргументы команды; первым элементом рекомендуется передавать объект с флагами (wait, settingsFile и т.д.)
	 * @param projectPath — корень проекта 1С; без него расширение работает
	 *   с открытой папкой VS Code
	 * @param timeoutMs — таймаут ожидания; при wait: true рекомендуется 300 000 мс
	 * @returns commandResult от сервера; при ok === false выбрасывает Error
	 */
	public async executeCommand(
		commandId: string,
		args: unknown[] | undefined,
		projectPath: string | undefined,
		timeoutMs?: number
	): Promise<unknown> {
		const result = await this.request<{
			ok?: boolean;
			commandResult?: unknown;
			message?: string;
		}>("executeCommand", {
			commandId,
			args,
			projectPath,
		}, timeoutMs);

		if (result?.ok === false) {
			throw new Error(
				result.message ??
					`Команда ${commandId} вернула ok = false без сообщения`
			);
		}

		return result?.commandResult;
	}

	/**
	 * Запрашивает у расширения список зарегистрированных command ID.
	 *
	 * @returns массив command ID (пустой при недоступности расширения/IPC)
	 */
	public async listCommands(): Promise<string[]> {
		const res = await this.request<{ commands?: string[] }>("listCommands");
		return res?.commands ?? [];
	}

	/**
	 * Запрашивает список команд с заголовками для описаний инструментов.
	 *
	 * Расширения прошлых версий отдают только идентификаторы: тогда описание
	 * инструмента строится из одного идентификатора.
	 *
	 * @returns описания команд (id, заголовок, категория)
	 */
	public async listCommandDescriptors(): Promise<CommandDescriptor[]> {
		const res = await this.request<{
			commands?: string[];
			descriptors?: CommandDescriptor[];
		}>("listCommands");
		if (res?.descriptors && res.descriptors.length > 0) {
			return res.descriptors;
		}
		return (res?.commands ?? []).map((id) => ({ id }));
	}
}
