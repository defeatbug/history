-- ============================================================================
-- HistoriaQuest — 后台支持（一）：封面图片字段 + 对象存储
-- Migration: 20250101000006_admin_media
--
-- 内容：
--   1. courses / museums 新增 cover_url 列（真实图片）
--      —— cover_image（emoji）保留为降级方案，向后兼容，老数据无需迁移
--   2. 建立 media bucket 与对象级 RLS 策略
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 封面图片字段
--
--    语义约定：
--      cover_image  emoji 图标           —— 未上传图片时的降级显示
--      cover_url    真实图片的公开 URL   —— 上传后优先显示
--
--    不复用 cover_image 存 URL 的原因：emoji 与 URL 语义混在一起后，
--    前端只能靠「是不是 http 开头」来猜，属于隐式约定，难以维护。
-- ---------------------------------------------------------------------------
alter table public.courses
  add column if not exists cover_url text;

alter table public.museums
  add column if not exists cover_url text;

comment on column public.courses.cover_url is '课程封面图片 URL；为空时前端回退到 cover_image（emoji）';
comment on column public.museums.cover_url is '博物馆封面图片 URL；为空时前端回退到 cover_image（emoji）';

-- ---------------------------------------------------------------------------
-- 2. 对象存储 bucket
--
--    单一 bucket，用路径前缀区分用途：
--      covers/courses/<uuid>.webp
--      covers/museums/<uuid>.webp
--      artifacts/<uuid>.webp
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  true,                                   -- 公开读：课程图片必须让学生无需登录即可加载
  5242880,                                -- 单文件 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 3. storage.objects 的访问策略
--
--    读：所有人（bucket 已是 public，这里显式声明便于审计）
--    写/改/删：仅管理员
-- ---------------------------------------------------------------------------
drop policy if exists media_public_read on storage.objects;
create policy media_public_read
  on storage.objects for select
  to public
  using (bucket_id = 'media');

drop policy if exists media_admin_insert on storage.objects;
create policy media_admin_insert
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'media' and public.is_admin());

drop policy if exists media_admin_update on storage.objects;
create policy media_admin_update
  on storage.objects for update
  to authenticated
  using (bucket_id = 'media' and public.is_admin())
  with check (bucket_id = 'media' and public.is_admin());

drop policy if exists media_admin_delete on storage.objects;
create policy media_admin_delete
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'media' and public.is_admin());
