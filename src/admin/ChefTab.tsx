import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { api, message, newId, type ChefPost, type ChefPosts } from "./api";

const CHEFS = [
  { key: "nadia", label: "وصفات الشيف نادية السيد", emoji: "👩‍🍳" },
  { key: "magda", label: "وصفات الشيف ماجدة النجار", emoji: "🥘" },
] as const;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function blankPost(): ChefPost {
  return { id: newId("p"), title: "", assetPath: "", imageUrl: "", sourceUrl: "" };
}

function PostEditor({ open, post, onClose, onInsert }: {
  open: boolean;
  post: ChefPost | null;
  onClose: () => void;
  onInsert: (post: ChefPost, previewUrl: string) => void;
}) {
  const [draft, setDraft] = useState<ChefPost>(blankPost);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(post ? { ...post, signedUrl: undefined } : blankPost());
      setPreview(post?.signedUrl ?? "");
      setError("");
    }
  }, [open, post]);

  async function pickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setError("الصورة يجب أن تكون PNG أو JPEG أو WebP.");
    if (file.size > 5 * 1024 * 1024) return setError("حجم الصورة يجب أن يقل عن 5 ميغابايت.");
    setUploading(true);
    try {
      const result = await api<{ path: string }>("/api/upload", {
        method: "POST", headers: { "content-type": file.type }, body: file,
      });
      setDraft(d => ({ ...d, imageUrl: result.path }));
      setPreview(URL.createObjectURL(file));
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      setUploading(false);
    }
  }

  function save() {
    if (!ID_PATTERN.test(draft.id)) return setError("المعرّف: حروف لاتينية وأرقام و_ و- فقط (حتى 64).");
    if (!draft.title.trim()) return setError("عنوان المنشور مطلوب.");
    if (draft.sourceUrl && !/^https:\/\//.test(draft.sourceUrl)) return setError("رابط المصدر يجب أن يبدأ بـ https://");
    onInsert({ ...draft, title: draft.title.trim(), sourceUrl: draft.sourceUrl.trim(), signedUrl: undefined }, preview);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{post ? "تعديل منشور" : "منشور جديد"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>المعرّف</Label>
            <Input dir="ltr" value={draft.id} disabled={!!post}
              onInput={e => setDraft(d => ({ ...d, id: (e.target as HTMLInputElement).value }))} />
          </div>
          <div className="grid gap-2">
            <Label>العنوان</Label>
            <Input dir="auto" maxLength={200} value={draft.title}
              onInput={e => setDraft(d => ({ ...d, title: (e.target as HTMLInputElement).value }))} />
          </div>
          <div className="grid gap-2">
            <Label>رابط المنشور على فيسبوك</Label>
            <Input dir="ltr" maxLength={300} placeholder="https://www.facebook.com/reel/…" value={draft.sourceUrl}
              onInput={e => setDraft(d => ({ ...d, sourceUrl: (e.target as HTMLInputElement).value }))} />
          </div>
          <div className="grid gap-2">
            <Label>صورة المنشور</Label>
            {preview
              ? <img src={preview} alt="معاينة" className="max-h-48 w-full rounded-xl border border-[#e6d7c3] object-cover" />
              : draft.assetPath
                ? <p className="rounded-xl bg-[#f3eadc] px-3 py-6 text-center text-sm text-muted-foreground">
                  صورتها مضمّنة داخل التطبيق ({draft.assetPath}) — ارفعي صورة جديدة لاستبدالها على الموقع فقط.
                </p>
                : null}
            <div className="flex items-center gap-3">
              <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? "جارٍ الرفع…" : "اختيار صورة"}
              </Button>
              {draft.imageUrl && <code dir="ltr" className="truncate text-xs text-muted-foreground">{draft.imageUrl}</code>}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pickFile} />
            </div>
          </div>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button className="bg-[#c2410c] text-white hover:bg-[#9a3412]" onClick={save}>تأكيد</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChefList({ posts, onChange }: {
  posts: ChefPost[];
  onChange: (posts: ChefPost[]) => void;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const editing = editingIndex === null ? null : posts[editingIndex] ?? null;

  function upsert(post: ChefPost, previewUrl: string) {
    if (previewUrl) setPreviews(p => ({ ...p, [post.id]: previewUrl }));
    if (editingIndex === null) {
      if (posts.some(p => p.id === post.id)) return toast.error("معرّف المنشور مستخدم بالفعل.");
      onChange([...posts, post]);
    } else {
      onChange(posts.map((p, i) => i === editingIndex ? post : p));
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{posts.length ? `${posts.length} منشورًا` : "لا منشورات بعد — أضيفي أول منشور."}</p>
        <Button size="sm" className="bg-[#c2410c] text-white hover:bg-[#9a3412]"
          onClick={() => { setEditingIndex(null); setEditorOpen(true); }}>+ منشور جديد</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {posts.map((post, i) => (
          <Card key={post.id} className="overflow-hidden border-[#e6d7c3] transition-shadow hover:shadow-md">
            <div className="grid aspect-[4/3] place-items-center bg-[#f3eadc]">
              {previews[post.id] || post.signedUrl
                ? <img src={previews[post.id] ?? post.signedUrl} alt={post.title} className="size-full object-cover" />
                : <span className="text-4xl" title="صورة مضمّنة في التطبيق">📷</span>}
            </div>
            <CardContent className="grid gap-2 p-4">
              <h3 className="line-clamp-2 font-bold leading-snug">{post.title}</h3>
              {post.sourceUrl && (
                <a href={post.sourceUrl} target="_blank" rel="noreferrer" dir="ltr"
                  className="line-clamp-1 text-xs text-[#c2410c] hover:underline">{post.sourceUrl}</a>
              )}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { setEditingIndex(i); setEditorOpen(true); }}>تعديل</Button>
                {confirmDelete === post.id ? (
                  <>
                    <Button size="sm" variant="destructive" onClick={() => { onChange(posts.filter(p => p.id !== post.id)); setConfirmDelete(null); }}>تأكيد الحذف</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>تراجع</Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setConfirmDelete(post.id)}>حذف</Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <PostEditor open={editorOpen} post={editing} onClose={() => setEditorOpen(false)} onInsert={upsert} />
    </div>
  );
}

export default function ChefTab({ value, onChange }: {
  value: ChefPosts;
  onChange: (value: ChefPosts) => void;
}) {
  return (
    <Tabs defaultValue="nadia">
      <TabsList>
        {CHEFS.map(chef => (
          <TabsTrigger key={chef.key} value={chef.key}>{chef.emoji} {chef.label}</TabsTrigger>
        ))}
      </TabsList>
      {CHEFS.map(chef => (
        <TabsContent key={chef.key} value={chef.key} className="pt-4">
          <ChefList posts={value[chef.key]} onChange={posts => onChange({ ...value, [chef.key]: posts })} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
