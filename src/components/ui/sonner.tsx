import type { ReactNode } from "react";
import { Toaster as Sonner } from "sonner";
import { Check, X, TriangleAlert, Info, LoaderCircle } from "lucide-react";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Every message in the app (about 150 call sites) goes through this one
 * component, so styling it here restyles all of them at once.
 *
 * Success is a solid green circle with a white tick; failure is a solid red
 * circle with a white cross. The tint behind the message and the coloured
 * left edge are there so the outcome reads at a glance, before the text
 * does. That matters when someone is mid-task and glancing back at the
 * screen to see whether their action worked.
 *
 * The trailing "!" on each class is Tailwind v4's important modifier.
 * Sonner injects its own background and border rules, so without it the
 * colours below silently don't apply.
 */

const BADGE =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white";

function IconBadge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`${BADGE} ${tone}`}>{children}</span>;
}

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      position="top-center"
      closeButton
      duration={5000}
      icons={{
        success: (
          <IconBadge tone="bg-emerald-500">
            <Check className="h-4 w-4" strokeWidth={3} />
          </IconBadge>
        ),
        error: (
          <IconBadge tone="bg-red-500">
            <X className="h-4 w-4" strokeWidth={3} />
          </IconBadge>
        ),
        warning: (
          <IconBadge tone="bg-amber-500">
            <TriangleAlert className="h-4 w-4" strokeWidth={2.5} />
          </IconBadge>
        ),
        info: (
          <IconBadge tone="bg-blue-500">
            <Info className="h-4 w-4" strokeWidth={2.5} />
          </IconBadge>
        ),
        loading: (
          <LoaderCircle className="h-5 w-5 animate-spin text-slate-500" />
        ),
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast gap-4! rounded-xl! border! border-l-4! px-4! py-3.5! shadow-xl! text-[14px]! font-medium!",
          title: "font-semibold!",
          description: "text-[13px]! font-normal! opacity-80!",
          // Sonner gives the icon a fixed 16px box, left-aligned. Our badge is
          // 28px, so it used to spill 12px out of that box and sit hard against
          // the text — the toast's gap was being spent on the overflow, leaving
          // none. Sizing the box to the badge makes the gap a real gap.
          icon: "m-0! h-7! w-7! justify-center!",
          closeButton: "bg-white! border-slate-200! text-slate-500!",
          actionButton: "bg-slate-900! text-white!",
          cancelButton: "bg-slate-100! text-slate-700!",
          success:
            "bg-emerald-50! border-emerald-200! border-l-emerald-500! text-emerald-950!",
          error: "bg-red-50! border-red-200! border-l-red-500! text-red-950!",
          warning:
            "bg-amber-50! border-amber-200! border-l-amber-500! text-amber-950!",
          info: "bg-blue-50! border-blue-200! border-l-blue-500! text-blue-950!",
          default:
            "bg-white! border-slate-200! border-l-slate-400! text-slate-900!",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
