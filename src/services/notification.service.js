/**
 * Notification Service - 푸시 구독 / 알림 설정 관리 + 이벤트 발생 시 발송
 */

const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const pushService = require('./push.service');

const DEFAULT_PREFS = { danger: true, visitor: true, motion: false, sound: true, briefing: true };

const NOTIFY_TITLES = {
  danger: '🚨 위험 알림',
  visitor: '🚪 방문자 알림',
  motion: '🚶 움직임 알림',
  sound: '🔔 소리 알림'
};

const saveSubscription = async (userId, subscription) => {
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    const err = new Error('Invalid push subscription payload');
    err.statusCode = 400;
    throw err;
  }

  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .upsert({ user_id: userId, endpoint, p256dh, auth }, { onConflict: 'endpoint' });

  if (error) throw error;
};

const removeSubscription = async (userId, endpoint) => {
  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', endpoint);

  if (error) throw error;
};

const getPreferences = async (userId) => {
  const { data, error } = await supabaseAdmin
    .from('notification_preferences')
    .select('danger, visitor, motion, sound, briefing')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data || { ...DEFAULT_PREFS };
};

const savePreferences = async (userId, prefs = {}) => {
  const payload = {
    user_id: userId,
    danger: !!prefs.danger,
    visitor: !!prefs.visitor,
    motion: !!prefs.motion,
    sound: !!prefs.sound,
    briefing: !!prefs.briefing
  };

  const { error } = await supabaseAdmin
    .from('notification_preferences')
    .upsert(payload, { onConflict: 'user_id' });

  if (error) throw error;

  const { user_id, ...rest } = payload;
  return rest;
};

/**
 * 이벤트 생성 시 호출 — 실시간 알림(danger/visitor/motion/sound) 발송
 * 실패해도 이벤트 생성 흐름을 막지 않도록 이 함수 내부에서 모든 에러를 흡수한다.
 */
const notifyEvent = async (event) => {
  try {
    if (!pushService.isConfigured()) return;
    if (!event?.device_id) return;

    const prefKey = event.type;
    if (!['danger', 'visitor', 'motion', 'sound'].includes(prefKey)) return;

    const { data: device, error: deviceError } = await supabaseAdmin
      .from('devices')
      .select('user_id')
      .eq('id', event.device_id)
      .maybeSingle();

    if (deviceError || !device?.user_id) return;

    const prefs = await getPreferences(device.user_id);
    if (!prefs[prefKey]) return;

    const { data: subs, error: subError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', device.user_id);

    if (subError || !subs?.length) return;

    const payload = {
      title: NOTIFY_TITLES[prefKey] || 'HOME-TALK 알림',
      body: event.description,
      eventId: event.id,
      dangerLevel: event.danger_level
    };

    await Promise.all(subs.map(async (sub) => {
      try {
        await pushService.sendToSubscription(sub, payload);
      } catch (err) {
        // 만료/삭제된 구독은 정리
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
        } else {
          logger.error('[Notification] Push 발송 실패:', err.message);
        }
      }
    }));

  } catch (err) {
    logger.error('[Notification] notifyEvent 오류:', err);
  }
};

module.exports = {
  saveSubscription,
  removeSubscription,
  getPreferences,
  savePreferences,
  notifyEvent
};
