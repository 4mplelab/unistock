import type { Blocker } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// useUnsavedChangesGuardが返すblockerをそのまま渡す。state==="blocked"のときだけ表示する
export default function UnsavedChangesDialog({ blocker }: { blocker: Blocker }) {
  const open = blocker.state === "blocked";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && blocker.state === "blocked" && blocker.reset()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>保存されていない変更があります</DialogTitle>
          <DialogDescription>
            このページを離れると、保存していない変更は失われます。移動しますか？
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => blocker.state === "blocked" && blocker.reset()}>
            このページに留まる
          </Button>
          <Button variant="destructive" onClick={() => blocker.state === "blocked" && blocker.proceed()}>
            変更を破棄して移動する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
