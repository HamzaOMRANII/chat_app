package com.omranisystems.hchat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * Runs while a call is in progress: Android keeps the microphone (and the camera for video) when the screen is off
 * or H_CHAT goes to the background. Shows an ongoing "call in progress" notification that opens the app.
 */
public class CallService extends Service {
    static final String CHANNEL = "hc_ongoing_call";
    static final int ID = 4401;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        boolean video = intent != null && intent.getBooleanExtra("video", false);
        String who = intent == null ? null : intent.getStringExtra("who");
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Call in progress", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while a call is running");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open != null) open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_hchat)
            .setColor(0xFF8C2A3F)
            .setContentTitle("H_CHAT · call in progress")
            .setContentText(who == null || who.isEmpty() ? "Tap to return to the call" : "With " + who + " · tap to return")
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(tap)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            if (video && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
            try {
                startForeground(ID, n, type);
            } catch (Exception e) {
                // Camera not allowed in the background on this phone: keep at least the microphone
                startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            }
        } else {
            startForeground(ID, n);
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // The app was swiped away: the call is over
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
