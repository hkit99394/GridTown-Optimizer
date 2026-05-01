/**
 * Canonical core package boundary.
 *
 * The implementation modules still live under `src/core` during the staged
 * migration. New package-facing exports should route through this entry point
 * so the eventual workspace move can stay mechanical.
 */

export * from "../../core/index.js";
