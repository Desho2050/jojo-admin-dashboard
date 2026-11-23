import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { normalizeArabic, type Meta, type Recipe } from "./api";

export default function MetaTab({ recipes, meta, onMetaChange }: {
  recipes: Recipe[];
  meta: Meta;
  onMetaChange: (meta: Meta) => void;
}) {
  const [query, setQuery] = useState("");
  const featured = meta.featured;
  const nameOf = (id: string) => recipes.find(r => r.id === id)?.name ?? id;
  const emojiOf = (id: string) => recipes.find(r => r.id === id)?.emoji ?? "🍽";

  const candidates = recipes.filter(r => !featured.includes(r.id)).filter(r => {
    const q = normalizeArabic(query.trim());
    return !q || normalizeArabic(`${r.name} ${r.id}`).includes(q);
  });

  const move = (index: number, delta: number) => {
    const next = [...featured];
    const j = index + delta;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    onMetaChange({ ...meta, featured: next });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="border-[#e6d7c3]">
        <CardContent className="grid gap-3 p-5">
          <h3 className="font-bold">وصفات الرئيسية — تظهر في أول التطبيق</h3>
          <p className="text-sm text-muted-foreground">رتّبي الوصفات المختارة كما ستظهر في شريط «الأكثر طلباً» داخل التطبيق.</p>
          <ol className="grid gap-2">
            {featured.map((id, i) => (
              <li key={id} className="flex items-center gap-2 rounded-xl border border-[#e6d7c3] bg-[#faf6ef] px-3 py-2">
                <span className="grid size-6 place-items-center rounded-full bg-[#c2410c] text-xs font-bold text-white">{i + 1}</span>
                <span className="text-lg">{emojiOf(id)}</span>
                <span className="flex-1 truncate font-medium">{nameOf(id)}</span>
                <Button size="sm" variant="ghost" aria-label="أعلى" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
                <Button size="sm" variant="ghost" aria-label="أسفل" disabled={i === featured.length - 1} onClick={() => move(i, 1)}>↓</Button>
                <Button size="sm" variant="ghost" aria-label="إزالة" className="text-red-600"
                  onClick={() => onMetaChange({ ...meta, featured: featured.filter(x => x !== id) })}>✕</Button>
              </li>
            ))}
            {!featured.length && <li className="py-6 text-center text-sm text-muted-foreground">لم تختاري أي وصفة بعد.</li>}
          </ol>
        </CardContent>
      </Card>

      <Card className="border-[#e6d7c3]">
        <CardContent className="grid gap-3 p-5">
          <h3 className="font-bold">إضافة وصفة إلى الرئيسية</h3>
          <Input dir="auto" placeholder="ابحثي بالاسم…" value={query} onInput={e => setQuery((e.target as HTMLInputElement).value)} />
          <ul className="grid max-h-[28rem] gap-2 overflow-y-auto">
            {candidates.map(r => (
              <li key={r.id} className="flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 hover:bg-[#f3eadc]">
                <span className="text-lg">{r.emoji}</span>
                <span className="flex-1 truncate">{r.name}</span>
                <Button size="sm" variant="outline"
                  onClick={() => onMetaChange({ ...meta, featured: [...featured, r.id] })}>+</Button>
              </li>
            ))}
            {!candidates.length && <li className="py-6 text-center text-sm text-muted-foreground">كل الوصفات مختارة أو لا نتيجة للبحث.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
