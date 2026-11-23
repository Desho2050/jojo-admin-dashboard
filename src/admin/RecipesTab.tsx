import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import RecipeEditor from "./RecipeEditor";
import {
  CATEGORY_NAMES, KITCHENS, KITCHEN_NAMES, normalizeArabic,
  type Recipe,
} from "./api";

export default function RecipesTab({ recipes, onChange }: {
  recipes: Recipe[];
  onChange: (recipes: Recipe[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [kitchen, setKitchen] = useState("");
  const [category, setCategory] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const previewsRef = useRef<Record<string, string>>({});

  useEffect(() => () => {
    Object.values(previewsRef.current).forEach(url => {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    });
  }, []);

  const visible = useMemo(() => {
    const q = normalizeArabic(query.trim());
    const terms = q ? q.split(/\s+/).filter(t => t.length > 1) : [];
    return recipes.filter(r => {
      if (kitchen && r.kitchen !== kitchen) return false;
      if (category && r.category !== category) return false;
      if (!terms.length) return true;
      const hay = normalizeArabic(`${r.name} ${r.subtitle} ${CATEGORY_NAMES[r.category]} ${KITCHEN_NAMES[r.kitchen]} ${r.description} ${r.ingredients.map(i => i.name).join(' ')}`);
      return terms.every(t => hay.includes(t));
    });
  }, [recipes, query, kitchen, category]);

  function upsert(recipe: Recipe, previewUrl: string) {
    if (previewUrl.startsWith("blob:") && recipe.imageUrl) {
      const previous = previewsRef.current[recipe.imageUrl];
      if (previous?.startsWith("blob:") && previous !== previewUrl) URL.revokeObjectURL(previous);
      previewsRef.current = { ...previewsRef.current, [recipe.imageUrl]: previewUrl };
      setPreviews(previewsRef.current);
    }
    const exists = recipes.some(r => r.id === recipe.id);
    onChange(exists ? recipes.map(r => r.id === recipe.id ? recipe : r) : [...recipes, recipe]);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input dir="auto" className="max-w-xs" placeholder="ابحثي في الوصفات والمكوّنات…"
          value={query} onInput={e => setQuery((e.target as HTMLInputElement).value)} />
        <NativeSelect aria-label="تصفية بالمطبخ" value={kitchen} onChange={e => setKitchen(e.target.value)}>
          <NativeSelectOption value="">كل المطابخ</NativeSelectOption>
          {KITCHENS.map(k => <NativeSelectOption key={k} value={k}>{KITCHEN_NAMES[k]}</NativeSelectOption>)}
        </NativeSelect>
        <NativeSelect aria-label="تصفية بالتصنيف" value={category} onChange={e => setCategory(e.target.value)}>
          <NativeSelectOption value="">كل التصنيفات</NativeSelectOption>
          {Object.entries(CATEGORY_NAMES).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
        </NativeSelect>
        <span className="text-sm text-muted-foreground">{visible.length} من {recipes.length}</span>
        <Button className="ms-auto bg-[#c2410c] text-white hover:bg-[#9a3412]"
          onClick={() => { setEditing(null); setEditorOpen(true); }}>+ وصفة جديدة</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map(recipe => {
          const imageUrl = (recipe.imageUrl ? previews[recipe.imageUrl] : undefined) ?? recipe.signedImageUrl;
          return (
          <Card key={recipe.id} className="border-[#e6d7c3] transition-shadow hover:shadow-md">
            <CardContent className="grid gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  {imageUrl
                    ? <img src={imageUrl} alt="" className="size-12 shrink-0 rounded-xl bg-[#f3eadc] object-cover" />
                    : <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#f3eadc] text-2xl">{recipe.emoji}</span>}
                  <div>
                    <h3 className="font-bold leading-snug">{recipe.name}</h3>
                    <p className="text-xs text-muted-foreground">{KITCHEN_NAMES[recipe.kitchen]} · {CATEGORY_NAMES[recipe.category]}</p>
                  </div>
                </div>
                <Badge variant="secondary" className="shrink-0 bg-[#f3eadc]">{recipe.id}</Badge>
              </div>
              {recipe.subtitle && <p dir="auto" className="line-clamp-2 text-sm text-muted-foreground">{recipe.subtitle}</p>}
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>⏱ {recipe.prepMinutes + recipe.cookMinutes} دقيقة</span>
                <span>🍽 {recipe.servings} أشخاص</span>
                <span>🧾 {recipe.ingredients.length} مكوّن</span>
                <span>👣 {recipe.steps.length} خطوة</span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline"
                  onClick={() => { setEditing(recipe); setEditorOpen(true); }}>تعديل</Button>
                {confirmDelete === recipe.id ? (
                  <>
                    <Button size="sm" variant="destructive"
                      onClick={() => { onChange(recipes.filter(r => r.id !== recipe.id)); setConfirmDelete(null); }}>
                      تأكيد الحذف
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>تراجع</Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setConfirmDelete(recipe.id)}>حذف</Button>
                )}
              </div>
            </CardContent>
          </Card>
          );
        })}
      </div>
      {!visible.length && <p className="py-10 text-center text-muted-foreground">لا وصفة مطابقة للبحث الحالي.</p>}

      <RecipeEditor open={editorOpen} recipe={editing} existingIds={recipes.map(r => r.id)}
        onClose={() => setEditorOpen(false)} onInsert={upsert} />
    </div>
  );
}
