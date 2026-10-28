import Image from "next/image";

import { cn } from "@/lib/utils";

type AuthLogoProps = {
  className?: string;
  priority?: boolean;
};

// Login screen logo. recafco-logo.png is a square canvas with wide white
// margins (artwork spans roughly y 21%-90%), so a 6:5 box with object-cover
// positioned at 50% 83% trims that dead space evenly instead of shrinking
// the Arabic/English lettering inside a square. Size it with a width class;
// the aspect ratio does the rest.
export function AuthLogo({ className, priority = false }: AuthLogoProps) {
  return (
    <div className={cn("relative aspect-[6/5] shrink-0", className)}>
      <Image
        src="/recafco-logo.png"
        alt="RECAFCO logo"
        fill
        className="object-cover object-[50%_83%]"
        sizes="(min-width: 1280px) 180px, 150px"
        priority={priority}
      />
    </div>
  );
}
