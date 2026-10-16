/**
 * Notices about uploads whose screen has gone.
 *
 * An upload outlives the editor that started it: a person can press Done or
 * follow a link while the bytes are still on their way. When such an upload
 * then fails, or lands without its link, the editor that would have said so
 * is gone. The notice comes here instead, and one host at the top of the app
 * (`UploadNotices`) shows it whatever screen is open now. A plain module
 * store rather than a context: the reporter is a callback that runs after
 * its component unmounted, so it can no longer reach anything React holds.
 */

export interface UploadNotice {
  id: number;
  /** One sentence naming the files and the page. */
  title: string;
  /** What went wrong, in the upload flow's own words. */
  detail: string;
}

let notices: readonly UploadNotice[] = [];
let next = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Report an upload whose screen has gone. `files` are the names the person
 * picked, `page` what the editor was editing (a title or a path).
 */
export function reportOrphanUpload(
  files: readonly string[],
  page: string,
  detail: string,
): void {
  const named = files.length === 0 ? "a file" : files.join(", ");
  const onto = page === "" ? "" : ` to ${page}`;
  notices = [
    ...notices,
    {
      id: next,
      title: `The upload of ${named}${onto} did not finish.`,
      detail,
    },
  ];
  next += 1;
  emit();
}

/** Take one notice down, once the person dismissed it. */
export function dismissUploadNotice(id: number): void {
  notices = notices.filter((notice) => notice.id !== id);
  emit();
}

export function subscribeUploadNotices(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function uploadNotices(): readonly UploadNotice[] {
  return notices;
}
