# Source mapping — from a clicked element to a file and line

The prompt is only as useful as the file path in it. Without one, an agent gets
"the paragraph under the countdown" and has to go looking. With one, it opens
the file that actually renders that paragraph and starts there.

This page explains where that path comes from, how to turn it on, and what you
get when it is off.

## Two attributes, two different files

At build time the loader puts a source location on every JSX element. The host
element and the component element get **different** attribute names:

| Attribute    | Means                                              | Example                              |
| ------------ | -------------------------------------------------- | ------------------------------------ |
| `data-imp-o` | **Call site** — the file that *used* the component  | `app/dashboard/page.tsx:42:7`        |
| `data-imp`   | **Definition** — the file that *wrote* the DOM tag  | `components/ui/button.tsx:57:5`      |

Given `<Button variant="ghost">Save</Button>` written in `page.tsx`, the button
component spreads its props onto a real `<button>`, so the rendered DOM ends up
carrying both:

```html
<button data-imp="components/ui/button.tsx:57:5"
        data-imp-o="app/dashboard/page.tsx:42:7">Save</button>
```

The file worth opening is almost always the **call site**. The definition is a
shared component — editing it to satisfy one screen changes every other screen
that uses it. That is why the prompt lists both and names them.

The two names exist for a mundane reason: if both used one attribute name,
which one survived would depend on each component's prop-spread order. Separate
names mean neither can overwrite the other.

At feedback time the widget walks up from the clicked node to the nearest
element carrying either attribute, so a click on an inner `<span>` still
resolves through its parent.

## Turning it on

### Next.js

```js
// next.config.mjs
import { withLocalFeedbacker } from "local-feedbacker/next";

export default withLocalFeedbacker({
  // your existing config
});
```

Layering it under other config wrappers is fine:

```js
export default withSentryConfig(withLocalFeedbacker(nextConfig), sentryOptions);
```

The wrapper does four things: injects the attributes above, turns on
`productionBrowserSourceMaps`, strips `sourcesContent` out of the emitted maps
(see [privacy](privacy.md)), and writes a route → file manifest so a prompt can
name the page file even when nothing was instrumented.

Each is switchable:

| Option                          | Default | Turns off                              |
| ------------------------------- | ------- | -------------------------------------- |
| `injectSourceAttributes`        | `true`  | the `data-imp` / `data-imp-o` injection |
| `stripSourceContent`            | `true`  | removing original source text from maps |
| `emitRouteManifest`             | `true`  | the route → file manifest              |

```js
export default withLocalFeedbacker(nextConfig, { emitRouteManifest: false });
```

### Next.js with Turbopack

Next 16 builds with Turbopack by default, and Turbopack never runs webpack
plugins. Attribute injection still works — the wrapper registers a Turbopack
rule for it — but nothing that ran as a plugin does, which means no route
manifest and, more importantly, **source maps that keep their original source
text unless you strip them yourself**:

```jsonc
// package.json
"scripts": {
  "build": "next build && local-feedbacker-strip-maps"
}
```

The binary takes an optional project directory, defaulting to the working
directory:

```bash
local-feedbacker-strip-maps ./apps/web
```

Skipping this in a webpack build is harmless — the plugin already did it, and
running it twice changes nothing.

### Plain webpack (CRA, custom setups)

```js
// webpack.config.js
const { LocalFeedbackerWebpackPlugin } = require("local-feedbacker/webpack");

module.exports = {
  devtool: "source-map",
  plugins: [new LocalFeedbackerWebpackPlugin()],
};
```

That covers stripping. To also inject the attributes, add the loader ahead of
your other JS transforms:

```js
module: {
  rules: [
    {
      test: /\.(tsx|jsx)$/,
      exclude: /node_modules/,
      enforce: "pre",
      use: [{ loader: require.resolve("local-feedbacker/jsx-source-loader") }],
    },
  ],
}
```

## Why the attribute value is sometimes not a path

The loader has two modes:

- **`id`** (webpack builds) — the attribute holds a short opaque file ID, and a
  manifest emitted next to the build maps IDs back to paths. The markup stays
  small and the shape of your source tree is not written into every element.
- **`path`** (Turbopack) — the project-relative path is embedded verbatim,
  because emitting a manifest needs a webpack plugin.

The widget resolves IDs by fetching
`/_next/static/chunks/impakers-debug-src-manifest.json`. If that request fails,
IDs stay unresolved and the prompt simply omits the confirmed source rather
than guessing.

## What you get with the instrumentation off

Everything else still works — this package's whole point is that it degrades to
something useful rather than to nothing:

- the element, its text, and the copy around it
- the route the feedback was left on
- the modal it was left inside, and what opened that modal
- an attached screenshot, if one was captured

What disappears is the **Confirmed implementation source** section. The prompt
never presents an inferred location as a confirmed one; unverified context is
labelled as supporting context instead. An agent that receives a route and an
element description will find the file — it just reads a few more files first.

## When the file it names looks wrong

Almost always the call site never reached the DOM. See
[writing components](writing-components.md) for the two ways that happens and
how to author around them.
