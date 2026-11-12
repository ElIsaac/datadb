import * as React from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SqlRisk } from "@/lib/sql-safety";

interface ConfirmRiskyQueryDialogProps {
  risks: SqlRisk[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function ConfirmRiskyQueryDialog({
  risks,
  open,
  onOpenChange,
  onConfirm,
}: ConfirmRiskyQueryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-gdb-warnfg">
            <AlertTriangleIcon className="size-4" />
            Operación riesgosa
          </DialogTitle>
          <DialogDescription>
            {risks.length === 1
              ? "Se detectó lo siguiente antes de ejecutar:"
              : `Se detectaron ${risks.length} sentencias riesgosas:`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
          {risks.map((risk, i) => (
            <div
              key={i}
              className="rounded-lg border border-gdb-warn/30 bg-gdb-warn/10 p-2 text-xs"
            >
              <p className="text-foreground">{risk.message}</p>
              <pre className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                {risk.statement.trim()}
              </pre>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            Ejecutar de todos modos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
