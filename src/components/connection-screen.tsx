import * as React from "react";
import { IjIcon } from "@/components/ij-icon";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  testConnection,
  listProfiles,
  saveProfile,
  updateProfile,
  deleteProfile,
  connect,
} from "@/lib/api";
import type { ConnectionProfile, ConnectionProfileInput, Session } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DEFAULT_PROFILE_COLOR, PRESET_PROFILE_COLORS } from "@/lib/profile-colors";
import { readOnlyEnforcedByDatabase, readOnlyProtectionNote } from "@/server/db/read-only-session";

interface ConnectionScreenProps {
  onConnected: (session: Session) => void;
}

const emptyForm: ConnectionProfileInput = {
  type: "postgres",
  host: "localhost",
  port: 5432,
  user: "",
  password: "",
  database: "",
  name: "",
  color: DEFAULT_PROFILE_COLOR,
  readOnly: false,
};

const PRESET_COLORS = PRESET_PROFILE_COLORS;

export function ConnectionScreen({ onConnected }: ConnectionScreenProps) {
  const [form, setForm] = React.useState({ ...emptyForm });
  const [profiles, setProfiles] = React.useState<ConnectionProfile[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    loadProfiles();
  }, []);

  async function loadProfiles() {
    try {
      const list = await listProfiles();
      setProfiles(list);
    } catch (err) {
      toast.error(String(err));
    }
  }

  function updateForm<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Al cambiar de motor, si el puerto seguía siendo el default del motor
      // anterior, lo actualizamos al default del nuevo motor (no pisa un
      // puerto que el usuario haya editado a mano).
      if (key === "type") {
        const defaultPorts: Record<typeof next.type, number> = {
          postgres: 5432,
          mysql: 3306,
          sqlserver: 1433,
          mongodb: 27017,
        };
        if (Object.values(defaultPorts).includes(prev.port)) {
          next.port = defaultPorts[value as typeof next.type];
        }
      }
      return next;
    });
  }

  async function handleTest() {
    setLoading(true);
    try {
      const res = await testConnection(form);
      if (res.ok) toast.success("Conexión exitosa");
      else toast.error(res.error || "Error de conexión");
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!form.name) {
      toast.error("El nombre del perfil es obligatorio");
      return;
    }
    try {
      if (editingId) {
        await updateProfile(editingId, form);
        toast.success("Perfil actualizado");
        setEditingId(null);
        setForm({ ...emptyForm });
      } else {
        await saveProfile(form);
        toast.success("Perfil guardado");
      }
      await loadProfiles();
    } catch (err) {
      toast.error(String(err));
    }
  }

  function editProfile(profile: ConnectionProfile) {
    setEditingId(profile.id);
    setForm({
      type: profile.type,
      host: profile.host,
      port: profile.port,
      user: profile.user,
      password: "",
      database: profile.database,
      name: profile.name,
      color: profile.color || DEFAULT_PROFILE_COLOR,
      readOnly: profile.readOnly,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({ ...emptyForm });
  }

  async function handleConnect() {
    setLoading(true);
    try {
      const session = await connect(form);
      toast.success(`Conectado a ${session.name}`);
      onConnected(session);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function connectProfile(profile: ConnectionProfile) {
    setLoading(true);
    try {
      const session = await connect(profile.id);
      toast.success(`Conectado a ${session.name}`);
      onConnected(session);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function removeProfile(id: string) {
    try {
      await deleteProfile(id);
      toast.success("Perfil eliminado");
      if (editingId === id) {
        cancelEdit();
      }
      await loadProfiles();
    } catch (err) {
      toast.error(String(err));
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-6">
      <div className="w-full max-w-3xl space-y-3 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl border border-border bg-secondary text-primary">
          <IjIcon name="database" size={32} />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">DataDB</h1>
        <p className="text-sm text-muted-foreground">Cliente SQL para PostgreSQL, MySQL y SQL Server</p>
      </div>

      <div className="w-full max-w-3xl space-y-8 rounded-xl border bg-card p-8 shadow-sm">
        <div className="flex justify-center">
          <div className="inline-flex rounded-lg border border-border bg-secondary p-1">
            <button
              type="button"
              onClick={() => updateForm("type", "postgres")}
              className={cn(
                "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all",
                form.type === "postgres"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-secondary-foreground hover:text-foreground"
              )}
            >
              <IjIcon name="database" />
              PostgreSQL
            </button>
            <button
              type="button"
              onClick={() => updateForm("type", "mysql")}
              className={cn(
                "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all",
                form.type === "mysql"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-secondary-foreground hover:text-foreground"
              )}
            >
              <IjIcon name="database" />
              MySQL
            </button>
            <button
              type="button"
              onClick={() => updateForm("type", "sqlserver")}
              className={cn(
                "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all",
                form.type === "sqlserver"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-secondary-foreground hover:text-foreground"
              )}
            >
              <IjIcon name="database" />
              SQL Server
            </button>
          </div>
        </div>

        <div className="grid grid-cols-6 gap-4">
          <div className="col-span-2 space-y-2">
            <Label>Host</Label>
            <Input
              value={form.host}
              onChange={(e) => updateForm("host", e.target.value)}
              placeholder="localhost"
            />
          </div>
          <div className="col-span-2 space-y-2">
            <Label>Port</Label>
            <Input
              type="number"
              value={form.port}
              onChange={(e) => updateForm("port", Number(e.target.value))}
              placeholder="5432"
            />
          </div>
          <div className="col-span-2 space-y-2">
            <Label>Database</Label>
            <Input
              value={form.database}
              onChange={(e) => updateForm("database", e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="col-span-4 space-y-2">
            <Label>User</Label>
            <Input
              value={form.user}
              onChange={(e) => updateForm("user", e.target.value)}
              placeholder={form.type === "sqlserver" ? "sa" : "postgres"}
            />
          </div>
          <div className="col-span-2 space-y-2">
            <Label>Profile Name</Label>
            <Input
              value={form.name}
              onChange={(e) => updateForm("name", e.target.value)}
              placeholder="Local Development"
            />
          </div>

          <div className="col-span-4 space-y-2">
            <Label>Password</Label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => updateForm("password", e.target.value)}
              placeholder={editingId ? "Dejar en blanco para mantener la actual" : "••••••••"}
            />
          </div>
          <div className="col-span-2 space-y-2">
            <Label>Profile Color</Label>
            <div className="flex items-center gap-2 pt-1">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => updateForm("color", color)}
                  className={cn(
                    "size-6 shrink-0 rounded-full border-2 transition-all",
                    (form.color || DEFAULT_PROFILE_COLOR).toLowerCase() === color.toLowerCase()
                      ? "border-foreground scale-110"
                      : "border-transparent hover:scale-105"
                  )}
                  style={{ backgroundColor: color }}
                  aria-label={`Seleccionar color ${color}`}
                />
              ))}
              <label
                className="relative size-6 shrink-0 cursor-pointer overflow-hidden rounded-full border border-border bg-secondary"
                aria-label="Color personalizado"
              >
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => updateForm("color", e.target.value)}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                />
                <span
                  className="pointer-events-none absolute inset-0"
                  style={{ backgroundColor: form.color }}
                />
              </label>
            </div>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={form.readOnly ?? false}
            onChange={(e) => updateForm("readOnly", e.target.checked)}
            className="size-3.5 accent-primary"
          />
          <IjIcon name="locked" />
          Conexión de solo lectura (bloquea INSERT/UPDATE/DELETE/DDL)
        </label>
        {/* R53: SQL Server no puede hacer cumplir el solo lectura en la sesión; que quede dicho al marcarlo. */}
        {form.readOnly && !readOnlyEnforcedByDatabase(form.type) && (
          <p
            role="note"
            className="-mt-1 flex items-start gap-2 rounded-md border border-gdb-warn/30 bg-gdb-warn/10 p-2 text-xs text-gdb-warnfg"
          >
            <IjIcon name="warning" className="mt-0.5 shrink-0" />
            {readOnlyProtectionNote(form.type)}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {editingId && (
            <span className="text-sm font-medium text-muted-foreground">
              Editando perfil «{profiles.find((p) => p.id === editingId)?.name}»
            </span>
          )}
          <div className="flex flex-wrap justify-end gap-2 ml-auto">
            <Button variant="outline" onClick={handleTest} disabled={loading}>
              <IjIcon name="connect" />
              Probar conexión
            </Button>
            {editingId && (
              <Button variant="ghost" onClick={cancelEdit} disabled={loading}>
                <IjIcon name="close" />
                Cancelar
              </Button>
            )}
            <Button variant="secondary" onClick={handleSave} disabled={loading}>
              {editingId ? "Guardar cambios" : "Guardar perfil"}
            </Button>
            <Button onClick={handleConnect} disabled={loading}>
              Conectar
            </Button>
          </div>
        </div>
      </div>

      {profiles.length > 0 && (
        <div className="w-full max-w-3xl">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Saved Profiles
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-secondary/50",
                  editingId === profile.id && "border-primary bg-secondary/50"
                )}
                onClick={() => connectProfile(profile)}
              >
                <div
                  className="size-3 rounded-full"
                  style={{ backgroundColor: profile.color || DEFAULT_PROFILE_COLOR }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {profile.name}
                    {profile.readOnly && (
                      <IjIcon name="locked" className="shrink-0" />
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    <span className="capitalize">{profile.type}</span>
                    <span className="mx-1.5">·</span>
                    <span className="font-jetbrains">
                      {profile.host}:{profile.port}
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    editProfile(profile);
                  }}
                >
                  <IjIcon name="edit" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeProfile(profile.id);
                  }}
                >
                  <IjIcon name="delete" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
