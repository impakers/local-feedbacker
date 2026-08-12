# Writing components the call site can survive

[Source mapping](source-mapping.md) explains the two attributes the widget
reads. This page is about the gap between "the loader injected them" and "the
clicked element actually carries them" — because a prompt that names a shared
component instead of the screen sends an agent to a file where a one-screen fix
becomes an every-screen change.

There are exactly two ways the call site goes missing, and both are things you
can see in your own component code.

## 1. A component that doesn't pass props through

The loader puts the call site on the *component* element. It reaches the DOM
only if the component forwards the props it was given onto something it
renders.

```tsx
// ✗ The call site stops here — nothing reaches the DOM
function Card({ title }: { title: string }) {
  return <section className="card"><h2>{title}</h2></section>;
}

// ✓ Spread the rest onto the element that represents this component
function Card({ title, ...props }: { title: string } & React.ComponentProps<"section">) {
  return <section className="card" {...props}><h2>{title}</h2></section>;
}
```

This matters most for the small wrappers a codebase accumulates — a `PageTitle`
around an `h1`, a `Row` around a `div`. They are the components most likely to
be written with an explicit prop list and no spread, and they are exactly what a
reviewer clicks on.

Two details worth knowing:

- Spread onto the **outermost** element the component renders. That is the node
  a click resolves through, because the widget walks *upward* from what was
  clicked.
- Spread after your own defaults but don't let a later `className=` overwrite
  the spread object's attributes — put `{...props}` where you would want a
  caller's props to win.

## 2. Portals — the ancestor chain stops short

Dialogs, sheets, popovers, dropdowns, and tooltips usually render through a
portal into `document.body`. In the DOM they are no longer inside the page that
opened them, so walking up from a click inside one never reaches anything the
page file wrote. What it reaches first is the dialog component's own definition.

The fix is not to avoid portals — it is to make sure the nearest instrumented
ancestor is a file worth opening:

```tsx
// ✗ In app/orders/page.tsx — the dialog's contents resolve to the shared dialog file
<Dialog open={open}>
  <DialogContent>…forty lines of order-cancellation UI…</DialogContent>
</Dialog>

// ✓ Give the dialog its own file; the page composes it
<OrderCancelDialog open={open} onOpenChange={setOpen} />
```

Now a click inside the dialog resolves to `order-cancel-dialog.tsx` — a file
that exists to serve this one screen, which is what an agent should edit.

The same reasoning applies to any complex piece of a page, portal or not: the
more a route file inlines, the more of the screen resolves to whatever shared
component happens to be nearest.

## Checking it rather than trusting it

You do not have to reason about this from the source. Inspect a rendered
element and read the attributes:

```js
// In the browser console, after clicking an element in devtools
$0.closest("[data-imp-o]")?.getAttribute("data-imp-o");
```

If that returns a shared component's path — or `null` — the call site is not
reaching the DOM there, and feedback left on that element will be missing its
confirmed source. Fixing one wrapper often repairs a whole screen at once.

## What is worth doing

Not every component needs this. The value shows up wherever people actually
leave feedback: page-level composition, anything portalled, and the thin
wrappers in between. Rendering the attributes on a leaf `<span>` deep inside a
design-system primitive adds nothing that its parent did not already say.
