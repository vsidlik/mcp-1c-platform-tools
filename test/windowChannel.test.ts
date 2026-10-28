/**
 * Тесты подключения MCP-сервера к каналу окна 1C: Platform Tools.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { hasWindowChannel, windowChannelEnv, type PlatformToolsApi } from "../src/windowChannel.js";

/** API с каналом окна, который отдаёт заданный адрес. */
function apiWith(endpoint: { path: string; token: string } | undefined): PlatformToolsApi {
	return { getMcpChannel: async () => endpoint };
}

describe("hasWindowChannel", () => {
	it("распознаёт API с каналом окна", () => {
		assert.strictEqual(hasWindowChannel(apiWith(undefined)), true);
	});

	it("прошлая версия 1C: Platform Tools ничего не экспортирует", () => {
		assert.strictEqual(hasWindowChannel(undefined), false);
		assert.strictEqual(hasWindowChannel(null), false);
	});

	it("API без канала окна не подходит", () => {
		assert.strictEqual(hasWindowChannel({}), false);
		assert.strictEqual(hasWindowChannel({ getMcpChannel: "нет" }), false);
	});
});

describe("windowChannelEnv", () => {
	it("передаёт серверу путь канала и токен сессии", async () => {
		const env = await windowChannelEnv(apiWith({ path: "\\\\.\\pipe\\1c-platform-tools-abc", token: "t0k3n" }));
		assert.deepStrictEqual(env, {
			ONEC_IPC_PIPE: "\\\\.\\pipe\\1c-platform-tools-abc",
			ONEC_IPC_TOKEN: "t0k3n",
		});
	});

	it("без канала окна переменных нет", async () => {
		assert.strictEqual(await windowChannelEnv(apiWith(undefined)), undefined);
	});
});
