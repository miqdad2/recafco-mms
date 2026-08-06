"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

// Job Card Work Tracking Entry Points and Assignment Visibility Unit 8B,
// Task 5: supports a "?section=work-time" deep link into the Job Card
// detail page (in addition to the plain "#work-time-tracking" fragment
// links used elsewhere) by smooth-scrolling to the target section once the
// page has rendered. Renders nothing.
export function ScrollToSection({
  paramName,
  paramValue,
  targetId,
}: {
  paramName: string;
  paramValue: string;
  targetId: string;
}) {
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get(paramName) !== paramValue) return;
    const el = document.getElementById(targetId);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [searchParams, paramName, paramValue, targetId]);

  return null;
}
