export interface AsyncLock<E = void, D = any> extends PromiseLike<E | undefined> {
	data: D | undefined;
	readonly locked: boolean;
	readonly lock: () => void;
	readonly unlock: (v: E) => void;
}
export interface AsyncLockConstructor {
	new <E = void, D = any>(): AsyncLock<E, D>;
	readonly prototype: AsyncLock;
}

export const AsyncLock: AsyncLockConstructor = class __proto__ {
	#v0: boolean = false;
	#v1: any;
	#g0: any;

	get data(): any { return this.#v1 || void 0; }
	set data(v: any) { this.#v1 = v; }
	get locked(): any { return this.#v0; }

	then(p0: any): this {
		if (typeof p0 === "function") {
			if (this.#v0)
				this.#g0 = p0;
			else
				p0.apply(void 0, []);
		}
		return this;
	}

	lock(): void {
		this.#v0 = true;
	}

	unlock(v: any): void {
		this.#v0 = false;
		this.#g0?.apply(v);
		this.#v1 = void 0;
	}
}

const __proto__ = AsyncLock.prototype;
Object.setPrototypeOf(__proto__, null);
Object.defineProperty(__proto__, Symbol.toStringTag, {
	value: "AsyncLock",
	writable: false,
	enumerable: false,
	configurable: false
});
Object.freeze(__proto__);
