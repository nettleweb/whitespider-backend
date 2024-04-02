export const AsyncLock = class AsyncLock {
    #v0 = false;
    #g0 = [];
    static {
        const __proto__ = AsyncLock.prototype;
        Object.setPrototypeOf(__proto__, null);
        Object.defineProperty(__proto__, Symbol.toStringTag, {
            value: "AsyncLock",
            writable: false,
            enumerable: false,
            configurable: false
        });
        Object.freeze(__proto__);
    }
    get locked() {
        return this.#v0;
    }
    then(p0) {
        if (typeof p0 === "function") {
            if (this.#v0)
                this.#g0.push(p0);
            else
                p0();
        }
    }
    lock() {
        this.#v0 = true;
    }
    unlock() {
        const cbs = this.#g0;
        for (const cb of cbs)
            cb();
        cbs.length = 0;
        this.#v0 = false;
    }
};
