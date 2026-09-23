/**
 * An environment variable's value, or undefined when it's unset, empty or only whitespace: a path
 * variable set to `""` must not become the current directory.
 */
export const envValue = (env: Readonly<Record<string, string | undefined>>, name: string) => {
  const value = env[name];

  return value === undefined || value.trim() === "" ? undefined : value;
};
