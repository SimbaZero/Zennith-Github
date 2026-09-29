import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ---------------------------------------------------------------------------
// The app's own confirmation box, used instead of the browser's
// window.confirm() — which shows "localhost:8080 says…" and can't be styled.
//
// Controlled: the page holds the thing being confirmed in state, passes
// open={thing !== null}, and clears it in onCancel. See admin.staff.tsx.
// ---------------------------------------------------------------------------

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for anything that deletes or revokes. */
  destructive?: boolean;
  busy?: boolean;
  /** Extra content under the description, e.g. a "type the name" box. */
  children?: ReactNode;
  /** Keeps the confirm button disabled until the extra check passes. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const confirmClass = props.destructive
    ? "bg-destructive text-white hover:bg-destructive/90"
    : "bg-[oklch(0.18_0.06_260)] text-white hover:bg-[oklch(0.25_0.08_260)]";

  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">
            {props.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {props.children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={props.busy}>
            {props.cancelLabel ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            className={confirmClass}
            disabled={props.busy || props.confirmDisabled}
            onClick={(e) => {
              e.preventDefault();
              props.onConfirm();
            }}
          >
            {props.busy ? "Working…" : (props.confirmLabel ?? "Confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
