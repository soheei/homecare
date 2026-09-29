/**
 * Storage Service - Supabase Storage 관리
 */

const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const path = require('path');

// 앱이 이벤트 사진/소리/영상을 볼 때 발급하는 서명 URL 유효시간 (events 버킷은 private)
const SIGNED_URL_EXPIRES_SEC = 60 * 60;
const MEDIA_FIELDS = ['image_url', 'audio_url', 'video_url'];

/**
 * DB에 저장된 Storage URL(…/storage/v1/object/public/<bucket>/<path>)에서 버킷 내부 경로를 꺼낸다.
 * 우리 Storage URL이 아니면(외부 URL 등) null.
 */
const extractStoragePath = (storedUrl, bucket = 'events') => {
  if (typeof storedUrl !== 'string') return null;
  const match = storedUrl.match(new RegExp(`/storage/v1/object/(?:public|sign|authenticated)/${bucket}/([^?]+)`));
  return match ? decodeURIComponent(match[1]) : null;
};

/**
 * 이벤트 목록의 image_url/audio_url/video_url을 서명 URL로 바꾼 복사본을 반환한다 (DB 값은 그대로).
 * private 버킷이라 저장된 public URL로는 열리지 않기 때문. 서명 요청은 한 번에 묶어서 보낸다.
 * 서명에 실패한 Storage URL은 null(열리지 않는 링크를 주지 않음), 외부 URL은 그대로 둔다.
 */
const signEventMedia = async (events, bucket = 'events', expiresIn = SIGNED_URL_EXPIRES_SEC) => {
  const paths = [...new Set(
    events.flatMap(e => MEDIA_FIELDS.map(f => extractStoragePath(e[f], bucket)).filter(Boolean))
  )];
  if (paths.length === 0) return events;

  const signedByPath = {};
  try {
    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrls(paths, expiresIn);
    if (error) throw error;
    (data || []).forEach(item => {
      if (item.signedUrl && !item.error) signedByPath[item.path] = item.signedUrl;
    });
  } catch (error) {
    logger.error('[Storage] Signed URL error:', error);
  }

  return events.map(event => {
    const signed = { ...event };
    MEDIA_FIELDS.forEach(field => {
      const filePath = extractStoragePath(event[field], bucket);
      if (filePath) signed[field] = signedByPath[filePath] || null;
    });
    return signed;
  });
};

/**
 * 삭제된 이벤트들의 사진/소리/영상 파일을 Storage에서 한 번에 지운다 → 지운 파일 수
 * DB 행을 지워도 Storage 파일은 자동으로 지워지지 않기 때문. 외부 URL은 건드리지 않는다.
 * 실패해도 throw하지 않음 (이벤트 삭제는 이미 끝났으므로 로그만 남김)
 */
const removeEventMedia = async (events, bucket = 'events') => {
  const paths = [...new Set(
    (events || []).flatMap(e => MEDIA_FIELDS.map(f => extractStoragePath(e[f], bucket)).filter(Boolean))
  )];
  if (paths.length === 0) return 0;

  try {
    const { error } = await supabaseAdmin.storage.from(bucket).remove(paths);
    if (error) throw error;
    logger.info(`[Storage] Removed ${paths.length} media files of deleted events`);
    return paths.length;
  } catch (error) {
    logger.error(`[Storage] Failed to remove media files (${paths.join(', ')}):`, error);
    return 0;
  }
};

/**
 * Supabase Storage에 파일 업로드
 * @param {Object} file - Multer 파일 객체
 * @param {string} bucket - 스토리지 버킷 이름 (events, profiles 등)
 * @returns {string|null} - 업로드된 파일의 Public URL
 */
const uploadFile = async (file, bucket = 'events') => {
  try {
    if (!file) return null;

    // 파일 확장자 추출
    const ext = path.extname(file.originalname);
    // 파일 타입별 폴더 분류 (image / audio / video)
    const typeFolder = file.mimetype.startsWith('video/') ? 'video'
                     : file.mimetype.startsWith('audio/') ? 'audio'
                     : 'image';
    // 유니크한 파일 이름 생성 (timestamp_random.ext)
    const fileName = `${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
    const filePath = `${typeFolder}/${fileName}`;

    logger.info(`[Storage] Uploading file to bucket: ${bucket}, path: ${filePath}`);

    // Supabase Storage에 업로드
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (error) {
      // 버킷이 없는 경우 등을 위해 에러 로깅
      logger.error(`[Storage] Supabase upload error: ${error.message}`);
      throw error;
    }

    // Public URL 가져오기
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(filePath);

    logger.info(`[Storage] File uploaded successfully: ${publicUrl}`);
    return publicUrl;

  } catch (error) {
    logger.error('[Storage] Upload error:', error);
    return null;
  }
};

/**
 * 파일 삭제
 * @param {string} publicUrl - 삭제할 파일의 Public URL
 * @param {string} bucket - 버킷 이름
 */
const deleteFile = async (publicUrl, bucket = 'events') => {
  try {
    if (!publicUrl) return;

    // URL에서 파일 경로 추출 (public/v1/storage/tokens/...)
    // 보통 publicUrl은 https://.../storage/v1/object/public/bucket/path/to/file 형태임
    const urlParts = publicUrl.split(`${bucket}/`);
    if (urlParts.length < 2) return;

    const filePath = urlParts[1];

    const { error } = await supabaseAdmin.storage
      .from(bucket)
      .remove([filePath]);

    if (error) throw error;
    logger.info(`[Storage] File deleted: ${filePath}`);

  } catch (error) {
    logger.error('[Storage] Delete error:', error);
  }
};

module.exports = {
  uploadFile,
  deleteFile,
  signEventMedia,
  removeEventMedia
};
