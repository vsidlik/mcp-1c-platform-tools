/**
 * Канал окна 1C: Platform Tools для MCP-сервера в VS Code.
 *
 * Расширение 1c-platform-tools открывает каждому окну свой канал: именованный
 * канал Windows или Unix-сокет со случайным именем и токеном сессии. Адрес
 * отдаёт API расширения, а MCP-сервер получает его переменными окружения,
 * поэтому сервер работает с тем окном, в котором запущен, и порт не нужен.
 *
 * Модуль не зависит от VS Code API: решения здесь проверяются тестами.
 */

/** Адрес канала окна. */
export interface WindowChannelEndpoint {
	/** Путь именованного канала Windows или Unix-сокета. */
	path: string;
	/** Токен сессии канала. */
	token: string;
}

/** Часть API 1C: Platform Tools, которой пользуется MCP-расширение. */
export interface PlatformToolsApi {
	/** Адрес канала окна; undefined — папке не доверяют или канал не открылся. */
	getMcpChannel(): Promise<WindowChannelEndpoint | undefined>;
}

/**
 * Даёт ли расширение канал окна: в прошлых версиях 1C: Platform Tools его нет.
 *
 * @param api — значение, которое вернула активация 1C: Platform Tools
 * @returns true, если в API есть канал окна
 */
export function hasWindowChannel(api: unknown): api is PlatformToolsApi {
	return typeof api === "object" && api !== null && typeof (api as Partial<PlatformToolsApi>).getMcpChannel === "function";
}

/**
 * Переменные окружения, которые подключают MCP-сервер к каналу окна.
 *
 * @param api — API 1C: Platform Tools
 * @returns переменные для сервера либо undefined, если канал окна недоступен
 */
export async function windowChannelEnv(api: PlatformToolsApi): Promise<Record<string, string> | undefined> {
	const endpoint = await api.getMcpChannel();
	if (!endpoint) {
		return undefined;
	}
	return { ONEC_IPC_PIPE: endpoint.path, ONEC_IPC_TOKEN: endpoint.token };
}
