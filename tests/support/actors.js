// A recording stand-in for a Clutter actor.
//
// The stubs under tests/stubs/ are built on this. It exists so that
// the unit suite can assert the extension's own bookkeeping — how many handlers
// are connected, how many are left after destroy, what style was applied, which
// children were added — rather than asserting that a stub behaves like a stub.
//
// GObject subclasses in gnome-shell are constructed through _init rather than a
// constructor, so the base here calls _init from its constructor and
// registerClass is the identity. That is why no GObject subclass in modules/
// may use class fields: they initialize after super() returns, which is after
// _init has already run — exactly as in real GJS.

/** Handlers connected anywhere, so a test can prove they were all released. */
export const liveHandlers = new Set();

// Per emitter, as gnome-shell's signalTracker.js is: emitter.disconnectObject
// (owner) releases only the handlers on THAT emitter. A stub that released an
// owner's handlers on every emitter at once would let the panel forget one
// and still look leak-free here.

/** Reset between tests. */
export function resetActors() {
    liveHandlers.clear();
}

let nextHandlerId = 1;

/** The behavior every fake actor and menu item shares. */
export class FakeActor {
    constructor(...args) {
        this.children = [];
        this.actions = [];
        this.style = null;
        this.visible = true;
        this.opacity = 255;
        this.pseudoClasses = new Set();
        this.reactive = true;
        this.styleClasses = new Set();
        this._parentActor = null;

        // Underscored on purpose. This is the stub's own bookkeeping, not an
        // API that exists: ClutterActor installs no `destroyed` property and
        // gnome-shell never reads one. A stub that offers a plausible-looking
        // name invites production code to depend on it, which is exactly what
        // happened — a guard reading `row.destroyed` was dead in a real Shell
        // and green in this suite.
        this._wasDestroyed = false;

        // Handler id -> {signal, callback, owner}
        this.handlers = new Map();

        this._init(...args);
    }

    /**
     * @param {object} [props] Properties to assign, as GJS does.
     */
    _init(props = {}) {
        Object.assign(this, props);
    }

    connect(signal, callback) {
        const id = nextHandlerId++;
        this.handlers.set(id, { signal, callback, owner: null });
        liveHandlers.add(id);
        return id;
    }

    disconnect(id) {
        this.handlers.delete(id);
        liveHandlers.delete(id);
    }

    /** gnome-shell's owner-scoped connect, from its signalTracker.js. */
    connectObject(...args) {
        const owner = args.pop();
        while (args.length >= 2) {
            const [signal, callback] = args.splice(0, 2);
            const id = nextHandlerId++;
            this.handlers.set(id, { signal, callback, owner });
            liveHandlers.add(id);
        }
    }

    disconnectObject(owner) {
        for (const [id, handler] of [...this.handlers])
            if (handler.owner === owner) this.disconnect(id);
    }

    /** Fire every handler for a signal, as the Shell would. */
    emit(signal, ...args) {
        for (const handler of [...this.handlers.values()])
            if (handler.signal === signal) handler.callback(this, ...args);
    }

    add_child(child) {
        this.children.push(child);
        child._parentActor = this;
    }

    insert_child_at_index(child, index) {
        this.children.splice(index, 0, child);
        child._parentActor = this;
    }

    remove_child(child) {
        this.children = this.children.filter(existing => existing !== child);
        child._parentActor = null;
    }

    remove_all_children() {
        for (const child of this.children) child._parentActor = null;
        this.children = [];
    }

    /** Real API, unlike the removed `destroyed`. Null once unparented. */
    get_parent() {
        return this._parentActor;
    }

    get_children() {
        return [...this.children];
    }

    add_action(action) {
        this.actions.push(action);
    }

    add_style_class_name(name) {
        this.styleClasses.add(name);
    }

    remove_style_class_name(name) {
        this.styleClasses.delete(name);
    }

    add_style_pseudo_class(name) {
        this.pseudoClasses.add(name);
    }

    remove_style_pseudo_class(name) {
        this.pseudoClasses.delete(name);
    }

    set_style(style) {
        this.style = style;
    }

    get_theme_node() {
        // Enough of a theme node for a max-height set through set_style() to
        // be read back the way St would read it.
        const match = /max-height:\s*(\d+)px/.exec(this.style ?? '');
        return { get_max_height: () => (match ? Number(match[1]) : -1) };
    }

    get_transformed_position() {
        return [0, this.transformedTop ?? 0];
    }

    get_preferred_height() {
        return [0, this.naturalHeight ?? 0];
    }

    navigate_focus() {
        this.focusNavigated = true;
        return true;
    }

    show() {
        this.visible = true;
    }

    hide() {
        this.visible = false;
    }

    destroy() {
        if (this._wasDestroyed) return;
        // As Clutter: 'destroy' is emitted first, while handlers are still
        // connected, which is what lets a subclass clean up from the signal.
        this.emit('destroy');
        this._wasDestroyed = true;
        this._parentActor = null;
        for (const id of [...this.handlers.keys()]) this.disconnect(id);

        // Clutter disposes an actor's actions with the actor, so a gesture
        // added to a row goes when the row does.
        for (const action of this.actions) action.destroy?.();
        this.actions = [];

        for (const child of this.children) child.destroy?.();
        this.children = [];
    }
}

/** Depth-first walk, for finding a row in a built menu. */
export function descendants(actor) {
    const found = [];
    const visit = node => {
        for (const child of node.children ?? []) {
            found.push(child);
            visit(child);
        }
    };
    visit(actor);
    return found;
}
