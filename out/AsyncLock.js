export const AsyncLock = class __proto__ {
    #v0 = false;
    #v1;
    #g0;
    get data() { return this.#v1 || void 0; }
    set data(v) { this.#v1 = v; }
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
    unlock(v) {
        this.#v0 = false;
        this.#g0?.apply(v);
        this.#v1 = void 0;
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
