export default class AsyncLock {
    #promise;
    #resolve;
    static {
        const __proto__ = AsyncLock.prototype;
        Object.setPrototypeOf(__proto__, null);
        Object.freeze(__proto__);
    }
    get locked() { return this.#promise != null; }
    lock() {
        return this.#promise || (this.#promise = new Promise((resolve) => {
            this.#resolve = resolve;
        }));
    }
    unlock() {
        this.#promise = void 0;
        this.#resolve?.apply(void 0, []);
    }
}
