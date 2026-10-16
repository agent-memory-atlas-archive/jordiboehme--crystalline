import { Loading } from "./Loading";

/**
 * The old name of the loading state, kept for the two editors until they
 * switch to {@link Loading} themselves (then this file goes). The first line
 * is made from the label: "Loading the editor" searches for "the editor".
 */
export function Skeleton({ label }: { label: string; rows?: number }) {
  return (
    <Loading
      label={label}
      subject={label.replace(/^(Loading|Connecting|Sweeping)\s+/, "")}
    />
  );
}
