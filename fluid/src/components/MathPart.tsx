/**
 * One formula, set by KaTeX.
 *
 * Its own module because of its own chunk: KaTeX and its stylesheet load when
 * a document actually holds math and never otherwise. It draws into an
 * element with `katex.render`, so no HTML string is built or injected. A
 * formula KaTeX cannot read stays on screen as the TeX that was written
 * (`throwOnError: false` paints it in the error colour).
 */

import "katex/dist/katex.min.css";

import katex from "katex";
import { useEffect, useRef } from "react";

export default function MathPart({
  tex,
  display,
}: {
  tex: string;
  display: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    katex.render(tex, element, {
      displayMode: display,
      throwOnError: false,
      strict: "ignore",
      trust: false,
    });
  }, [tex, display]);
  return <span ref={ref} />;
}
