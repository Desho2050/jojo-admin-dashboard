import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { api, message, tokenStore } from "./api";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ token: string }>("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      tokenStore.set(result.token);
      onSuccess();
    } catch (e) {
      setError(message(e));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-[#faf6ef] via-[#f6ecdd] to-[#f1dfc8] p-6">
      <Card className="w-full max-w-sm border-[#e6d7c3] shadow-lg shadow-orange-900/10">
        <CardContent className="grid gap-5 p-8">
          <div className="grid justify-items-center gap-2 text-center">
            <div className="grid size-16 place-items-center rounded-2xl bg-[#c2410c] text-3xl shadow-md shadow-orange-900/25">🍲</div>
            <h1 className="text-2xl font-bold">وصفات جوجو</h1>
            <p className="text-sm text-muted-foreground">لوحة تحكم محتوى التطبيق</p>
          </div>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor="username">المستخدم</Label>
              <Input id="username" value={username} autoComplete="username"
                onInput={e => setUsername((e.target as HTMLInputElement).value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">كلمة المرور</Label>
              <Input id="password" type="password" value={password} autoComplete="current-password"
                onInput={e => setPassword((e.target as HTMLInputElement).value)} required />
            </div>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full bg-[#c2410c] text-white hover:bg-[#9a3412]">
              {busy ? "جارٍ التحقق…" : "دخول"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
