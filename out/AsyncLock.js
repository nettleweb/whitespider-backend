export const AsyncLock = class __proto__ {
    #v0 = false;
    #g0;
    get locked() { return this.#v0; }
    then(p0) {
        if (typeof p0 === "function") {
            if (this.#v0)
                this.#g0 = p0;
            else
                p0.apply(void 0, []);
        }
        return this;
    }
    lock() {
        this.#v0 = true;
    }
    unlock() {
        this.#v0 = false;
        this.#g0?.apply(void 0, []);
    }
};
const __proto__ = AsyncLock.prototype;
Object.setPrototypeOf(__proto__, null);
Object.defineProperty(__proto__, Symbol.toStringTag, {
    value: "AsyncLock",
    writable: false,
    enumerable: false,
    configurable: false
});
Object.freeze(__proto__);
