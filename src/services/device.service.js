/**
 * Device Service - Edge Device 관리
 *
 * [버그 수정] 모든 읽기 쿼리를 supabaseAdmin으로 변경
 * 이유: RLS가 anon 키의 서버 내부 호출을 차단함
 */

const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

const getDevices = async (userId) => {
  try {
    let query = supabaseAdmin
      .from('devices')
      .select('*')
      .order('created_at', { ascending: false });

    // 'all'이 아닌 경우에만 user_id 필터 적용
    if (userId && userId !== 'all') {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];

  } catch (error) {
    logger.error('[DeviceService] Error fetching devices:', error);
    return [];
  }
};

const registerDevice = async ({ name, location, type, userId }) => {
  try {
    const deviceData = {
      name,
      location,
      type,
      user_id: userId,
      status: 'offline',
      created_at: new Date().toISOString(),
      last_heartbeat: null
    };

    const { data, error } = await supabaseAdmin
      .from('devices')
      .insert([deviceData])
      .select()
      .single();

    if (error) throw error;

    logger.info(`[DeviceService] Device registered: ${data.id}`);
    return data;

  } catch (error) {
    logger.error('[DeviceService] Error registering device:', error);
    return {
      id: `temp_${Date.now()}`,
      name, location, type,
      status: 'offline',
      created_at: new Date().toISOString()
    };
  }
};

const getDeviceStatus = async (deviceId) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('devices')
      .select('*')
      .eq('id', deviceId)
      .maybeSingle(); // single() → maybeSingle() : 없을 때 에러 대신 null 반환

    if (error) throw error;
    if (!data) return null;

    const isOnline = data.last_heartbeat &&
      (new Date() - new Date(data.last_heartbeat)) < 60000;

    return {
      ...data,
      isOnline,
      status: isOnline ? 'online' : 'offline'
    };

  } catch (error) {
    logger.error('[DeviceService] Error fetching device status:', error);
    return null;
  }
};

const updateHeartbeat = async (deviceId, { status, metrics }) => {
  try {
    const { error } = await supabaseAdmin
      .from('devices')
      .update({
        status: status || 'online',
        last_heartbeat: new Date().toISOString(),
        metrics: metrics || {}
      })
      .eq('id', deviceId);

    if (error) throw error;

    logger.debug(`[DeviceService] Heartbeat updated for device: ${deviceId}`);
    return true;

  } catch (error) {
    logger.error('[DeviceService] Error updating heartbeat:', error);
    return false;
  }
};

const deleteDevice = async (deviceId, userId) => {
  try {
    const { error } = await supabaseAdmin
      .from('devices')
      .delete()
      .eq('id', deviceId)
      .eq('user_id', userId);

    if (error) throw error;

    logger.info(`[DeviceService] Device deleted: ${deviceId}`);
    return true;

  } catch (error) {
    logger.error('[DeviceService] Error deleting device:', error);
    throw error;
  }
};

module.exports = {
  getDevices,
  registerDevice,
  getDeviceStatus,
  updateHeartbeat,
  deleteDevice
};
