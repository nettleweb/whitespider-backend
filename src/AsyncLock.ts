export interface AsyncLock extends PromiseLike<void> {
	readonly locked: boolean;
	readonly lock: () => void;
	readonly unlock: () => void;
}

export interface AsyncLockConstructor {
	new(): AsyncLock;
	readonly prototype: AsyncLock;
}

export const AsyncLock: AsyncLockConstructor = class __proto__ {
	#v0: boolean = false;
	#g0: Function | undefined;

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

	unlock(): void {
		this.#v0 = false;
		this.#g0?.apply(void 0, []);
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
