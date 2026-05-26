/**
 * Storage Service - Supabase Storage 관리
 */

const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const path = require('path');

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
    // 유니크한 파일 이름 생성 (timestamp_random.ext)
    const fileName = `${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
    const filePath = `${file.fieldname}/${fileName}`;

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
  deleteFile
};
