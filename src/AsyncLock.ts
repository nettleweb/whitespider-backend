export default class AsyncLock {
	#promise: Promise<void> | undefined;
	#resolve: (() => void) | undefined;

	static {
		const __proto__ = AsyncLock.prototype;
		Object.setPrototypeOf(__proto__, null);
		Object.freeze(__proto__);
	}

	get locked(): boolean { return this.#promise != null; }

	lock(): Promise<void> {
		return this.#promise || (this.#promise = new Promise((resolve) => {
			this.#resolve = resolve;
		}));
	}

	unlock() {
		this.#promise = void 0;
		this.#resolve?.apply(void 0, []);
	}
}

