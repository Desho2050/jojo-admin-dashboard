import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster, toast } from "sonner";
import {
  api, message, stripRecipeSignatures, stripSignatures, tokenStore,
  type Content, type DocKey,
} from "./admin/api";
import Login from "./admin/Login";
import RecipesTab from "./admin/RecipesTab";
import ChefTab from "./admin/ChefTab";
import MetaTab from "./admin/MetaTab";

const EMPTY: Content = { recipes: [], chefPosts: { nadia: [], magda: [] }, meta: { featured: [] } };

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [content, setContent] = useState<Content>(EMPTY);
  const [dirty, setDirty] = useState<Record<DocKey, boolean>>({ recipes: false, chef_posts: false, meta: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<Content>("/api/content");
      setContent({ recipes: data.recipes ?? [], chefPosts: data.chefPosts ?? EMPTY.chefPosts, meta: data.meta ?? EMPTY.meta });
      setDirty({ recipes: false, chef_posts: false, meta: false });
    } catch (e) {
      const err = e as { status?: number };
      if (err.status === 401) onLogout();
      else toast.error(message(e));
    } finally {
      setLoading(false);
    }
  }, [onLogout]);

  useEffect(() => { void load(); }, [load]);

  const anyDirty = dirty.recipes || dirty.chef_posts || dirty.meta;
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  function setRecipes(recipes: Content["recipes"]) {
    setContent(c => ({ ...c, recipes, meta: { ...c.meta, featured: c.meta.featured.filter(id => recipes.some(r => r.id === id)) } }));
    setDirty(d => ({ ...d, recipes: true, meta: true }));
  }
  function setChefPosts(chefPosts: Content["chefPosts"]) {
    setContent(c => ({ ...c, chefPosts }));
    setDirty(d => ({ ...d, chef_posts: true }));
  }
  function setMeta(meta: Content["meta"]) {
    setContent(c => ({ ...c, meta }));
    setDirty(d => ({ ...d, meta: true }));
  }

  async function save() {
    setSaving(true);
    const jobs: Array<[DocKey, unknown]> = [];
    if (dirty.recipes) jobs.push(["recipes", { items: stripRecipeSignatures(content.recipes) }]);
    if (dirty.chef_posts) jobs.push(["chef_posts", stripSignatures(content.chefPosts)]);
    if (dirty.meta) jobs.push(["meta", content.meta]);
    try {
      for (const [key, value] of jobs) await api("/api/documents", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, value }),
      });
      setDirty(d => {
        const next = { ...d };
        for (const [k] of jobs) next[k] = false;
        return next;
      });
      toast.success(`تم حفظ ${jobs.length === 1 ? "التغييرات" : `${jobs.length} مستندات`}.`);
    } catch (e) {
      const err = e as { status?: number };
      if (err.status === 401) onLogout();
      else toast.error(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-[#e6d7c3] bg-[#faf6ef]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <span className="grid size-10 place-items-center rounded-xl bg-[#c2410c] text-xl shadow-sm">🍲</span>
          <div className="me-auto">
            <h1 className="text-lg font-extrabold leading-tight">وصفات جوجو</h1>
            <p className="text-xs text-muted-foreground">لوحة تحكم محتوى التطبيق</p>
          </div>
          {anyDirty && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">تغييرات غير محفوظة</span>
          )}
          <Button variant="outline" size="sm" onClick={() => { if (!anyDirty || confirm("سيتم تجاهل التغييرات غير المحفوظة، متابعة؟")) void load(); }}>
            إعادة تحميل
          </Button>
          <Button size="sm" disabled={!anyDirty || saving} className="bg-[#c2410c] text-white hover:bg-[#9a3412] disabled:bg-[#d8b49c]" onClick={() => void save()}>
            {saving ? "جارٍ الحفظ…" : "حفظ التغييرات"}
          </Button>
          <Button size="sm" variant="ghost" className="text-red-700" onClick={() => { if (!anyDirty || confirm("ستفقد التغييرات غير المحفوظة، تسجيل الخروج؟")) onLogout(); }}>خروج</Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {loading ? (
          <p className="py-20 text-center text-muted-foreground" role="status">جارٍ تحميل المحتوى…</p>
        ) : (
          <Tabs defaultValue="recipes">
            <TabsList>
              <TabsTrigger value="recipes">🍲 الوصفات ({content.recipes.length})</TabsTrigger>
              <TabsTrigger value="chef">👩‍🍳 منشورات الشيفات ({content.chefPosts.nadia.length + content.chefPosts.magda.length})</TabsTrigger>
              <TabsTrigger value="meta">⭐ الرئيسية ({content.meta.featured.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="recipes" className="pt-4"><RecipesTab recipes={content.recipes} onChange={setRecipes} /></TabsContent>
            <TabsContent value="chef" className="pt-4"><ChefTab value={content.chefPosts} onChange={setChefPosts} /></TabsContent>
            <TabsContent value="meta" className="pt-4"><MetaTab recipes={content.recipes} meta={content.meta} onMetaChange={setMeta} /></TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(() => !!tokenStore.get());
  return (
    <>
      {authed
        ? <Dashboard onLogout={() => { tokenStore.clear(); setAuthed(false); }} />
        : <Login onSuccess={() => setAuthed(true)} />}
      <Toaster position="top-center" dir="rtl" />
    </>
  );
}
