FOR HUMAN REFERENCE ONLY

# `register` and builtin registration

```ts
function register(
  name: string,
  min: number,
  max: number | null,
  fn: (args: LispValue[]) => LispValue,
): void {
  builtins.set(name, { kind: "builtin", name, min, max, fn });
}
```

It's a small bookkeeping function: take a description of a builtin, wrap it in an object, and put it in a map under its name. Every `register("CAR", 1, 1, ...)` line is one entry in that map.

---

## The four parameters

### 1. `name: string` — the Lisp symbol name

This is the key used for lookup and also stored on the object so error messages can say `"CAR: wrong number of arguments"`.

It must be **uppercase** because of how names travel through the interpreter:

- `symbolName(node)` uppercases reader text: `car` → `"CAR"`
- `define`/`lookup` uppercase the key too: `"car"` → `"CAR"`
- `intern` uppercases for symbols

So the map's keys and the environment's keys live in the same uppercase namespace. A registration for `"car"` would be stored under a key nothing ever looks up — the function would silently not exist. That's why every registration is written in capitals.

### 2. `min: number` — minimum argument count

The fewest arguments the implementation can handle. `car` is `1`; `+` is `0` (it can be called with none, returning the identity); `assoc` is `2`.

### 3. `max: number | null` — maximum argument count

`null` means **unbounded**. `car` is `1` (exactly one); `+` is `null` (any number); `cons` is `2`.

`null` rather than `undefined` is deliberate. With `exactOptionalPropertyTypes` enabled in this project, an optional field can't be *assigned* `undefined` — only omitted — so an "optional max" would force conditional object construction. `null` is a real value that means "no limit", and it's explicit at every call site.

The pair `(min, max)` gives four classes for free:

| min | max | meaning | examples |
|---|---|---|---|
| n | n | exactly n | `car`, `cons`, `expt` |
| n | null | n or more | `+`, `*`, `append` |
| 0 | null | any number | `list` |
| 1 | 1 | exactly one | `length`, `not` |

### 4. `fn: (args: LispValue[]) => LispValue` — the implementation

This is the whole function value. Read the type carefully:

- `args: LispValue[]` — it receives an **array of already-evaluated values**. By the time this runs, `(+ 1 (- 5 2))` has become `[number 1, number 3]`. The builtin never sees AST nodes, never evaluates anything, and never touches the environment.
- `=> LispValue` — it must return a value from the same union everything else uses. That's why returning `{ kind: "number " }` (with a space) failed: the return type wasn't a `LispValue`.

Because the parameter type is declared on `register`, every arrow you pass is **contextually typed**: `(args) => …` gets `args: LispValue[]` with no annotation needed, and the return is checked against `LispValue`. This is the same mechanism that makes `{ kind: "atom" }` narrow correctly in object literals — the expected type is supplied by position, so literals don't widen.

### Return type `: void`

The function returns nothing. Its only effect is `builtins.set(...)`. `void` as the annotation says exactly that: don't use the result.

---

## What it stores

```ts
{ kind: "builtin", name, min, max, fn }
```

That object is a `BuiltInValue`, which is a member of `LispValue`. Shorthand properties mean `name` is `name: name`, etc. So this single object is both:

- **metadata** — name and arity, used by `applyBuiltIn`
- **the function itself** — the `fn` field
- **a first-class value** — because `kind: "builtin"` puts it in the union, `(funcall #'car …)`, `(apply #'+ …)`, `(let ((f #'car)) …)` all work

The `kind: "builtin"` discriminant is what lets callers narrow:

```ts
if (callable.kind === "builtin") return applyBuiltIn(callable, args);
if (callable.kind === "function") return applyFunction(callable, args);
```

Without that field, a builtin would be indistinguishable from a user function at the type level, and TS would refuse `.fn` or `.params`.

---

## Dissecting a call site

```ts
register("CAR", 1, 1, (args) => expectCons(args[0]!).car);
```

Reading left to right:

| piece | what it is |
|---|---|
| `register(` | calling the hoisted function declaration |
| `"CAR"` | name, uppercased to match lookup |
| `1, 1` | min 1, max 1 — exactly one argument |
| `(args) =>` | an arrow function, contextually typed by the declared `fn` parameter |
| `expectCons(args[0]!)` | runtime check that the argument is a cons, throwing otherwise |
| `args[0]!` | the non-null assertion; `noUncheckedIndexedAccess` makes `args[0]` `LispValue \| undefined`, and the arity check in `applyBuiltIn` guarantees it exists |
| `.car` | the cons's first field — a `LispValue` |

A variadic one:

```ts
register("+", 0, null, (args) => ({
  kind: "number",
  value: args.reduce((total, arg) => total + expectNumber(arg), 0),
}));
```

`0, null` = zero or more; `reduce` folds with a seed of `0`, so `(+)` → `0` and `(+ 1 2)` → `3`.

One with a block body, when a single expression won't do:

```ts
register("-", 1, null, (args) => {
  const first = expectNumber(args[0]!);
  if (args.length === 1) return { kind: "number", value: -first };
  return { kind: "number", value: args.slice(1).reduce(…, first) };
});
```

Both forms are just functions; the brace/expression choice is stylistic.

---

## When registration happens

These are **top-level statements**, not calls inside a function. They run once, when `builtins.ts` is first imported — Node evaluates a module's body a single time and caches it. So the table is populated before any Lisp code is evaluated.

Order matters because of `const`:

```ts
export const builtins = new Map<string, BuiltInValue>();   // must run first
function register(...) { builtins.set(...) }               // hoisted, fine anywhere
register("CAR", ...);                                      // must be after the const
```

`function` declarations are hoisted, so `register` could textually appear below its uses. But `builtins` is a `const`, and consts sit in the **temporal dead zone** until their line executes — calling `register` above that line throws `ReferenceError: Cannot access 'builtins' before initialization`.

---

## The runtime path for `(car x)`

1. The reader produces a `ListNode` with children `[atom "car", atom "x"]`.
2. `evaluate` sees a list, computes the head name `"CAR"`, and finds no special form case.
3. `default:` → `evalCall`.
4. `evalCall` evaluates the head atom → `lookup(env, "CAR")` → the `BuiltInValue` that `register` stored (installed into the root env by `createEnv`).
5. It evaluates the argument → `x`'s value.
6. `applyBuiltIn(fn, args)` checks `args.length` against `min`/`max`, then calls `fn.fn(args)`.
7. The arrow runs `expectCons(args[0]!).car` and returns a `LispValue`, which propagates back as the value of the whole form.

So `register` is only about **construction and storage**; arity checking and invocation live in `applyBuiltIn`, and dispatch lives in `evalCall`. Three small pieces, each with one job.

---

## Why a `Map`, and why a table at all

A `Map<string, BuiltInValue>` rather than an object literal because:

- keys are arbitrary strings with no prototype interference (`__proto__`, `constructor` are not special)
- `.keys()` / iteration order is insertion order, which matters for the root-env seeding loop
- `.size`, `.has`, `.get` are the exact operations needed

And a table rather than a giant `switch (name)` inside the evaluator because:

- adding a function is one line, with no risk of touching existing behaviour
- each registration is independently readable and testable
- the evaluator stays focused on special forms, where semantics actually differ

The tradeoff is indirection: reading `(car x)` means knowing to look for `"CAR"` in a table, rather than finding a `case "CAR"` in the evaluator.

---

## Small observations

- **`fn` appears twice** — as the parameter name and as the field name (`{ fn }` is `{ fn: fn }`). Legal, but `impl` would read better than `fn.fn(args)`.
- **Duplicate names silently overwrite.** `register("CAR", …)` twice keeps the last. Last-wins is fine, but nothing warns.
- **Nothing enforces uppercase at registration.** A lowercase name would compile, register, and never be found. A guard — `if (name !== name.toUpperCase()) throw` — would turn a silent miss into an immediate error.
- **Arity is data, not a check inside each function**, which is why none of the forty bodies contains `if (args.length …)` — the check happens once, in `applyBuiltIn`.
