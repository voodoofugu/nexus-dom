import { nexusDOMError } from "./errors.js";

type Cleanup = () => void;
type ErrorHandler = (error: unknown) => void;
const MOUNTED = Symbol("nexus-dom.owner-mounted");

interface OwnerIds {
  prefix: string;
  symbolIds: Map<symbol, number> | undefined;
  nextSymbolId: number;
  claims: Map<string, IdClaim> | undefined;
}

interface IdClaim {
  identity: string;
  owners: Owner | Set<Owner>;
}

const ID_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const hashIdentity = (value: string) => {
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first =
    Math.imul(first ^ (first >>> 16), 2246822507) ^
    Math.imul(second ^ (second >>> 13), 3266489909);
  second =
    Math.imul(second ^ (second >>> 16), 2246822507) ^
    Math.imul(first ^ (first >>> 13), 3266489909);
  let hash = (second & 0x1fffff) * 4294967296 + (first >>> 0);
  let encoded = "";
  for (let index = 0; index < 7; index++) {
    encoded = ID_ALPHABET[hash % ID_ALPHABET.length]! + encoded;
    hash = Math.floor(hash / ID_ALPHABET.length);
  }
  return encoded;
};

const encodeKey = (key: PropertyKey, ids: OwnerIds) => {
  if (typeof key === "string") return `s${key.length}:${key}`;
  if (typeof key === "number") {
    if (Object.is(key, -0)) return "n:-0";
    return `n:${String(key)}`;
  }
  const globalKey = Symbol.keyFor(key);
  if (globalKey !== undefined) return `g${globalKey.length}:${globalKey}`;
  const symbolIds = (ids.symbolIds ??= new Map());
  let symbolId = symbolIds.get(key);
  if (symbolId === undefined) {
    symbolId = ids.nextSymbolId++;
    symbolIds.set(key, symbolId);
  }
  return `y:${symbolId.toString(36)}`;
};

export class Owner {
  private children: Set<Owner> | undefined;
  private cleanups: Cleanup | Cleanup[] | undefined;
  private disposed = false;
  private errorHandler: ErrorHandler | undefined;
  private mounts: Cleanup | Cleanup[] | typeof MOUNTED | undefined;
  private readonly ids: OwnerIds;
  private readonly idPath: string;
  private nextIdChild = 0;

  constructor(
    readonly parent?: Owner,
    tracked = true,
    identity?: string
  ) {
    this.ids = parent?.ids ?? {
      prefix: identity ?? "r0",
      symbolIds: undefined,
      nextSymbolId: 0,
      claims: undefined,
    };
    this.idPath = parent
      ? `${parent.idPath}/${identity ?? parent.reserveIdSegment("o")}`
      : "";
    if (parent && tracked) (parent.children ??= new Set()).add(this);
  }

  reserveIdSegment(kind: string) {
    return `${kind}${(this.nextIdChild++).toString(36)}`;
  }

  keyedIdSegment(region: string, key: PropertyKey) {
    return `${region}/k${encodeKey(key, this.ids)}`;
  }

  id(localKey: string) {
    const identity = `v1\0${this.ids.prefix}\0${this.idPath}\0${localKey}`;
    const token = hashIdentity(identity);
    const claims = (this.ids.claims ??= new Map());
    const existing = claims.get(token);
    if (existing !== undefined && existing.identity !== identity) {
      throw nexusDOMError(
        "ID_HASH_COLLISION",
        `Component id hash collision for local key ${JSON.stringify(localKey)}.`
      );
    }
    const claim = existing ?? { identity, owners: this };
    if (existing) {
      if (existing.owners instanceof Set) existing.owners.add(this);
      else if (existing.owners !== this) {
        existing.owners = new Set([existing.owners, this]);
      }
    } else claims.set(token, claim);
    this.addCleanup(() => {
      if (claims.get(token) !== claim) return;
      if (claim.owners instanceof Set) {
        claim.owners.delete(this);
        if (claim.owners.size === 0) claims.delete(token);
        else if (claim.owners.size === 1) {
          claim.owners = claim.owners.values().next().value!;
        }
      } else if (claim.owners === this) claims.delete(token);
    });
    return `nxs-${token}`;
  }

  addCleanup(cleanup: Cleanup) {
    if (this.disposed) {
      cleanup();
      return;
    }
    const cleanups = this.cleanups;
    if (!cleanups) this.cleanups = cleanup;
    else if (Array.isArray(cleanups)) cleanups.push(cleanup);
    else this.cleanups = [cleanups, cleanup];
  }

  addMount(mount: Cleanup) {
    if (this.disposed) return;
    if (this.mounts === MOUNTED) {
      mount();
      return;
    }
    const mounts = this.mounts;
    if (!mounts) this.mounts = mount;
    else if (Array.isArray(mounts)) mounts.push(mount);
    else this.mounts = [mounts, mount];
  }

  isMounted() {
    return this.mounts === MOUNTED;
  }

  mount() {
    if (this.disposed || this.mounts === MOUNTED) return;
    const mounts = this.mounts;
    this.mounts = MOUNTED;
    if (Array.isArray(mounts)) {
      for (const mount of mounts) mount();
    } else mounts?.();
    if (this.children) {
      for (const child of this.children) child.mount();
    }
  }

  setErrorHandler(handler: ErrorHandler) {
    this.errorHandler = handler;
  }

  handleError(error: unknown): boolean {
    if (this.errorHandler) {
      try {
        this.errorHandler(error);
        return true;
      } catch (nextError) {
        if (this.parent) return this.parent.handleError(nextError);
        throw nextError;
      }
    }
    return this.parent?.handleError(error) ?? false;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mounts = undefined;

    if (this.children) {
      for (const child of Array.from(this.children)) child.dispose();
      this.children.clear();
      this.children = undefined;
    }

    const cleanups = this.cleanups;
    if (Array.isArray(cleanups)) {
      for (let index = cleanups.length - 1; index >= 0; index--) {
        cleanups[index]?.();
      }
      cleanups.length = 0;
    } else cleanups?.();
    this.cleanups = undefined;
    this.parent?.children?.delete(this);
  }
}

let currentOwner: Owner | undefined;

export function withOwner<T>(owner: Owner, run: () => T): T {
  const previous = currentOwner;
  currentOwner = owner;
  try {
    return run();
  } finally {
    currentOwner = previous;
  }
}

export function captureOwnerId() {
  if (!currentOwner) {
    throw nexusDOMError(
      "ID_OUTSIDE_COMPONENT",
      "Component ids can only be created while a component is mounting."
    );
  }
  const owner = currentOwner;
  let values: Map<string, string> | undefined;
  return (localKey: string) => {
    const current = values?.get(localKey);
    if (current !== undefined) return current;
    const value = owner.id(localKey);
    (values ??= new Map()).set(localKey, value);
    return value;
  };
}

/** Registers component cleanup against its current owner scope. */
export function onCleanup(cleanup: Cleanup) {
  if (!currentOwner) {
    throw nexusDOMError(
      "CLEANUP_OUTSIDE_COMPONENT",
      "onCleanup() must run inside a component."
    );
  }
  currentOwner.addCleanup(cleanup);
}
