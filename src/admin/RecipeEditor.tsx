import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  CATEGORIES, CATEGORY_NAMES, DIFFICULTIES, DIFFICULTY_NAMES, KITCHENS, KITCHEN_NAMES,
  api, message, type Recipe, newId,
} from "./api";

const ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function blankRecipe(): Recipe {
  return {
    id: newId("r"), name: "", subtitle: "", category: "MAIN", kitchen: "MASRI", emoji: "🍲", imageUrl: "",
    prepMinutes: 15, cookMinutes: 30, servings: 4, difficulty: "MEDIUM",
    description: "", ingredients: [{ name: "", amount: "" }], steps: [{ text: "", minutes: 0 }], notes: [],
  };
}

function Field(props: React.ComponentProps<typeof Input>) {
  return <Input dir="auto" {...props} />;
}

export default function RecipeEditor({ open, recipe, existingIds, onClose, onInsert }: {
  open: boolean;
  recipe: Recipe | null;
  existingIds: string[];
  onClose: () => void;
  onInsert: (recipe: Recipe, previewUrl: string) => void;
}) {
  const [draft, setDraft] = useState<Recipe>(blankRecipe);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const { signedImageUrl: _signedImageUrl, ...clean } = recipe ? JSON.parse(JSON.stringify(recipe)) : blankRecipe();
      setDraft(clean);
      setPreview(recipe?.signedImageUrl ?? "");
      setError("");
    } else {
      setPreview(current => {
        if (current.startsWith("blob:")) URL.revokeObjectURL(current);
        return "";
      });
    }
  }, [open, recipe]);

  function set<K extends keyof Recipe>(key: K, value: Recipe[K]) {
    setDraft(d => ({ ...d, [key]: value }));
  }

  async function pickImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      return setError("الصورة يجب أن تكون PNG أو JPEG أو WebP.");
    if (file.size > 5 * 1024 * 1024)
      return setError("حجم الصورة يجب أن يقل عن 5 ميغابايت.");
    setUploading(true);
    try {
      const result = await api<{ path: string }>("/api/upload", {
        method: "POST", headers: { "content-type": file.type }, body: file,
      });
      const nextPreview = URL.createObjectURL(file);
      setPreview(current => {
        if (current.startsWith("blob:")) URL.revokeObjectURL(current);
        return nextPreview;
      });
      setDraft(d => ({ ...d, imageUrl: result.path, signedImageUrl: undefined }));
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      setUploading(false);
    }
  }

  function save() {
    if (!ID_PATTERN.test(draft.id)) return setError("المعرّف: أحرف لاتينية صغيرة وأرقام وشرطة سفلية فقط، ويبدأ بحرف.");
    if (!existingIds.includes(draft.id) && recipe && draft.id !== recipe.id) return setError("هذا المعرّف مستخدم في وصفة أخرى.");
    if (!draft.name.trim()) return setError("اسم الوصفة مطلوب.");
    if (!draft.emoji.trim()) return setError("رمز تعبيري للوصفة مطلوب.");
    if (!draft.ingredients.every(i => i.name.trim())) return setError("كل مكوّن يحتاج اسمًا (المقدار اختياري).");
    if (!draft.steps.every(s => s.text.trim())) return setError("كل خطوة تحتاج نصًا.");
    const clean: Recipe = {
      ...draft,
      name: draft.name.trim(), subtitle: draft.subtitle.trim(), description: draft.description.trim(),
      imageUrl: draft.imageUrl ?? "", signedImageUrl: undefined,
      ingredients: draft.ingredients.map(i => ({ name: i.name.trim(), amount: (i.amount ?? "").trim() })),
      steps: draft.steps.map(s => ({ text: s.text.trim(), minutes: Number(s.minutes) || 0, ...(s.tip?.trim() ? { tip: s.tip.trim() } : {}) })),
      notes: draft.notes.map(n => n.trim()).filter(Boolean),
      prepMinutes: Number(draft.prepMinutes) || 0, cookMinutes: Number(draft.cookMinutes) || 0,
      servings: Math.max(1, Number(draft.servings) || 1),
    };
    const submittedPreview = preview;
    setPreview("");
    onInsert(clean, submittedPreview);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{recipe ? `تعديل: ${recipe.name}` : "وصفة جديدة"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>المعرّف (لاتيني، مثل koshari)</Label>
            <Field value={draft.id} onInput={e => set("id", (e.target as HTMLInputElement).value)} />
          </div>
          <div className="grid gap-2">
            <Label>الرمز التعبيري</Label>
            <Field value={draft.emoji} maxLength={8} onInput={e => set("emoji", (e.target as HTMLInputElement).value)} />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label>الاسم</Label>
            <Field value={draft.name} maxLength={120} onInput={e => set("name", (e.target as HTMLInputElement).value)} />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label>الوصف المختصر</Label>
            <Field value={draft.subtitle} maxLength={200} onInput={e => set("subtitle", (e.target as HTMLInputElement).value)} />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="recipe-image-file">صورة الوصفة (اختياري)</Label>
            <p id="recipe-image-help" className="text-sm text-muted-foreground">
              PNG أو JPEG أو WebP، حتى 5 ميغابايت. بدون صورة يظهر الرمز التعبيري في التطبيق.
            </p>
            {preview
              ? <img src={preview} alt="معاينة صورة الوصفة" className="aspect-video w-full rounded-xl border border-[#e6d7c3] object-cover" />
              : <div className="grid aspect-video w-full place-items-center rounded-xl border border-dashed border-[#e6d7c3] bg-[#faf6ef]">
                  <div className="text-center">
                    <span className="text-5xl" aria-hidden="true">{draft.emoji || "🍽"}</span>
                    <p className="mt-2 text-sm text-muted-foreground">لم تُرفع صورة بعد</p>
                  </div>
                </div>}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={uploading}
                aria-describedby="recipe-image-help" onClick={() => fileRef.current?.click()}>
                {uploading ? "جارٍ الرفع…" : draft.imageUrl ? "تغيير الصورة" : "اختيار صورة"}
              </Button>
              {draft.imageUrl && <Button type="button" size="sm" variant="ghost" className="text-red-600"
                disabled={uploading} onClick={() => {
                  setPreview(current => {
                    if (current.startsWith("blob:")) URL.revokeObjectURL(current);
                    return "";
                  });
                  set("imageUrl", "");
                  set("signedImageUrl", undefined);
                }}>إزالة الصورة</Button>}
              <input ref={fileRef} id="recipe-image-file" type="file" accept="image/png,image/jpeg,image/webp"
                className="hidden" aria-describedby="recipe-image-help" onChange={pickImage} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>التصنيف</Label>
            <NativeSelect value={draft.category} className="w-full"
              onChange={e => set("category", e.target.value)}>
              {CATEGORIES.map(c => <NativeSelectOption key={c} value={c}>{CATEGORY_NAMES[c]}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label>المطبخ</Label>
            <NativeSelect value={draft.kitchen} className="w-full"
              onChange={e => set("kitchen", e.target.value)}>
              {KITCHENS.map(k => <NativeSelectOption key={k} value={k}>{KITCHEN_NAMES[k]}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label>الصعوبة</Label>
            <NativeSelect value={draft.difficulty} className="w-full"
              onChange={e => set("difficulty", e.target.value)}>
              {DIFFICULTIES.map(d => <NativeSelectOption key={d} value={d}>{DIFFICULTY_NAMES[d]}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-2">
              <Label>تحضير (د)</Label>
              <Input type="number" min={0} max={600} value={draft.prepMinutes}
                onInput={e => set("prepMinutes", Number((e.target as HTMLInputElement).value))} />
            </div>
            <div className="grid gap-2">
              <Label>طهي (د)</Label>
              <Input type="number" min={0} max={1440} value={draft.cookMinutes}
                onInput={e => set("cookMinutes", Number((e.target as HTMLInputElement).value))} />
            </div>
            <div className="grid gap-2">
              <Label>أشخاص</Label>
              <Input type="number" min={1} max={100} value={draft.servings}
                onInput={e => set("servings", Number((e.target as HTMLInputElement).value))} />
            </div>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label>الوصف الكامل</Label>
            <Textarea rows={4} dir="auto" value={draft.description} maxLength={5000}
              onInput={e => set("description", (e.target as HTMLTextAreaElement).value)} />
          </div>
        </div>

        <Separator />
        <section className="grid gap-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">المكوّنات</h3>
            <Button size="sm" variant="outline"
              onClick={() => set("ingredients", [...draft.ingredients, { name: "", amount: "" }])}>+ إضافة</Button>
          </div>
          {draft.ingredients.map((ing, i) => (
            <div key={i} className="grid grid-cols-[1fr_10rem_auto] gap-2">
              <Field placeholder="المكوّن" value={ing.name}
                onInput={e => set("ingredients", draft.ingredients.map((x, j) => j === i ? { ...x, name: (e.target as HTMLInputElement).value } : x))} />
              <Field placeholder="المقدار" value={ing.amount}
                onInput={e => set("ingredients", draft.ingredients.map((x, j) => j === i ? { ...x, amount: (e.target as HTMLInputElement).value } : x))} />
              <Button size="icon" variant="ghost" aria-label="حذف المكوّن" className="text-red-600"
                onClick={() => set("ingredients", draft.ingredients.filter((_, j) => j !== i))}>✕</Button>
            </div>
          ))}
        </section>

        <Separator />
        <section className="grid gap-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">خطوات التحضير</h3>
            <Button size="sm" variant="outline"
              onClick={() => set("steps", [...draft.steps, { text: "", minutes: 0 }])}>+ إضافة</Button>
          </div>
          {draft.steps.map((step, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem_auto] items-start gap-2">
              <div className="grid gap-2">
                <Textarea rows={2} dir="auto" placeholder={`الخطوة ${i + 1}`} value={step.text} maxLength={2000}
                  onInput={e => set("steps", draft.steps.map((x, j) => j === i ? { ...x, text: (e.target as HTMLTextAreaElement).value } : x))} />
                <Input dir="auto" placeholder="نصيحة (اختياري)" value={step.tip ?? ""} maxLength={1000}
                  onInput={e => set("steps", draft.steps.map((x, j) => j === i ? { ...x, tip: (e.target as HTMLInputElement).value } : x))} />
              </div>
              <Input type="number" min={0} max={600} aria-label="دقائق الخطوة" value={step.minutes}
                onInput={e => set("steps", draft.steps.map((x, j) => j === i ? { ...x, minutes: Number((e.target as HTMLInputElement).value) } : x))} />
              <Button size="icon" variant="ghost" aria-label="حذف الخطوة" className="text-red-600"
                onClick={() => set("steps", draft.steps.filter((_, j) => j !== i))}>✕</Button>
            </div>
          ))}
        </section>

        <Separator />
        <section className="grid gap-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">ملاحظات</h3>
            <Button size="sm" variant="outline" onClick={() => set("notes", [...draft.notes, ""])}>+ إضافة</Button>
          </div>
          {draft.notes.map((note, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-2">
              <Field dir="auto" placeholder="ملاحظة" value={note} maxLength={2000}
                onInput={e => set("notes", draft.notes.map((x, j) => j === i ? (e.target as HTMLInputElement).value : x))} />
              <Button size="icon" variant="ghost" aria-label="حذف الملاحظة" className="text-red-600"
                onClick={() => set("notes", draft.notes.filter((_, j) => j !== i))}>✕</Button>
            </div>
          ))}
        </section>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button className="bg-[#c2410c] text-white hover:bg-[#9a3412]" onClick={save}>تأكيد</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { blankRecipe };
