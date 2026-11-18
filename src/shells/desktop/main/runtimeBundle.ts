/** A development run starts its runtime from a bundle rebuilt after every edit
 *  (`CATE_RUNTIME_BUNDLE`, see CLAUDE.md): the app's own build must not replace it. */
export const runtimeBundleOverride = (env: NodeJS.ProcessEnv): boolean => !!env.CATE_RUNTIME_BUNDLE
