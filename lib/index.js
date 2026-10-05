/**
 * dsh-promptimizer — host half.
 *
 * Deliberately inert: the optimizer is entirely a client-plane concern. This
 * half exists so the loader has a module to mount and boot logs carry the
 * plugin version for support diagnostics.
 */
export const inject = []

export function apply(ctx) {
  ctx.logger?.info?.('promptimizer: host half mounted (client half carries the optimizer)')
}
