declare global {
	export module globalThis {
		export var window: any;
	}

	export interface AsyncLock extends PromiseLike<void> {
		readonly locked: boolean;
		readonly lock: () => void;
		readonly unlock: () => void;
	}
	export interface AsyncLockConstructor {
		new(): AsyncLock;
		readonly prototype: AsyncLock;
	}

	export interface MessageFile {
		readonly name: string;
		readonly type: string;
		readonly url: string;
	}
	export interface Message {
		readonly id: string;
		readonly msg: string;
		readonly uid?: string;
		readonly vip?: number;
		readonly user: string;
		readonly icon: string | Buffer;
		readonly files: MessageFile[];
	}

	export const enum SIOPath {
		login = 0,
		login2 = 10,
		register = 11,
		userinfo = 1,
		userdata = 2,
		changeid = 3,
		changeavatar = 4,
		changePassword = 9,
	
		requestmessages = 7,
		postmessage = 8
	}
}
export {};