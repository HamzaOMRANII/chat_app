package com.omranisystems.hchat;

import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.List;

/**
 * Where a call's sound plays. Order: 1. a connected headset, earbuds or any other audio device, 2. the phone's
 * earpiece, 3. the loudspeaker, only when asked. During a call the volume buttons control the call volume.
 */
@CapacitorPlugin(name = "CallAudio")
public class CallAudioPlugin extends Plugin {
    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    private static boolean isHeadset(int type) {
        return type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
            || type == AudioDeviceInfo.TYPE_WIRED_HEADSET
            || type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
            || type == AudioDeviceInfo.TYPE_USB_HEADSET
            || type == AudioDeviceInfo.TYPE_HEARING_AID
            || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && type == AudioDeviceInfo.TYPE_BLE_HEADSET);
    }

    private PowerManager.WakeLock proximity;

    /** Earpiece: the screen turns off when the phone is at the ear (without pausing the call). */
    private void earMode(boolean on) {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (on) {
            if (proximity == null && pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
                proximity = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "hchat:call-ear");
            }
            if (proximity != null && !proximity.isHeld()) proximity.acquire(4 * 60 * 60 * 1000L);
        } else if (proximity != null && proximity.isHeld()) {
            proximity.release();
        }
    }

    private void afterRoute(AudioManager am) {
        earMode("earpiece".equals(state(am).getString("route")));
    }

    @PluginMethod
    public void start(PluginCall call) {
        // The call keeps the microphone (and camera) with the screen off or the app in the background
        Intent service = new Intent(getContext(), CallService.class);
        service.putExtra("video", Boolean.TRUE.equals(call.getBoolean("video", false)));
        service.putExtra("who", call.getString("who", ""));
        try {
            androidx.core.content.ContextCompat.startForegroundService(getContext(), service);
        } catch (Exception ignored) {
            // Without it the call still works while the screen is on
        }
        AudioManager am = audio();
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        getActivity().runOnUiThread(() -> getActivity().setVolumeControlStream(AudioManager.STREAM_VOICE_CALL));
        route(am, Boolean.TRUE.equals(call.getBoolean("speaker", false)));
        afterRoute(am);
        call.resolve(state(am));
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        AudioManager am = audio();
        route(am, Boolean.TRUE.equals(call.getBoolean("on", false)));
        afterRoute(am);
        call.resolve(state(am));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        earMode(false);
        getContext().stopService(new Intent(getContext(), CallService.class));
        AudioManager am = audio();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.clearCommunicationDevice();
        else {
            am.setSpeakerphoneOn(false);
            if (am.isBluetoothScoOn()) {
                am.setBluetoothScoOn(false);
                am.stopBluetoothSco();
            }
        }
        am.setMode(AudioManager.MODE_NORMAL);
        getActivity().runOnUiThread(() -> getActivity().setVolumeControlStream(AudioManager.USE_DEFAULT_STREAM_TYPE));
        call.resolve();
    }

    private static String kind(int type) {
        if (type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) return "speaker";
        if (type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) return "earpiece";
        if (type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && type == AudioDeviceInfo.TYPE_BLE_HEADSET)) return "bluetooth";
        if (type == AudioDeviceInfo.TYPE_WIRED_HEADSET || type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES) return "wired";
        if (type == AudioDeviceInfo.TYPE_USB_HEADSET) return "usb";
        if (type == AudioDeviceInfo.TYPE_HEARING_AID) return "hearing_aid";
        return "other";
    }

    /** Every place the call's sound can go, by name ("Galaxy Buds2", the earpiece, the loudspeaker…), and the current one. */
    @PluginMethod
    public void devices(PluginCall call) {
        AudioManager am = audio();
        JSArray list = new JSArray();
        String current = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                JSObject o = new JSObject();
                o.put("id", String.valueOf(d.getId()));
                o.put("kind", kind(d.getType()));
                o.put("name", d.getProductName() == null ? "" : d.getProductName().toString());
                list.put(o);
            }
            AudioDeviceInfo cur = am.getCommunicationDevice();
            if (cur != null) current = String.valueOf(cur.getId());
        } else {
            String[][] base = { { "earpiece", "earpiece" }, { "speaker", "speaker" } };
            for (String[] b : base) {
                JSObject o = new JSObject();
                o.put("id", b[0]);
                o.put("kind", b[1]);
                o.put("name", "");
                list.put(o);
            }
            if (hasBluetoothHeadset(am)) {
                JSObject o = new JSObject();
                o.put("id", "bluetooth");
                o.put("kind", "bluetooth");
                o.put("name", "");
                list.put(o);
            }
            current = am.isSpeakerphoneOn() ? "speaker" : am.isBluetoothScoOn() ? "bluetooth" : "earpiece";
        }
        JSObject out = new JSObject();
        out.put("devices", list);
        out.put("current", current);
        call.resolve(out);
    }

    /** The call's sound (and the matching microphone) on this device. */
    @PluginMethod
    public void setDevice(PluginCall call) {
        String id = call.getString("id", "");
        AudioManager am = audio();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                if (String.valueOf(d.getId()).equals(id)) {
                    am.setCommunicationDevice(d);
                    break;
                }
            }
        } else {
            boolean bt = "bluetooth".equals(id);
            am.setSpeakerphoneOn("speaker".equals(id));
            if (bt) {
                am.startBluetoothSco();
                am.setBluetoothScoOn(true);
            } else if (am.isBluetoothScoOn()) {
                am.setBluetoothScoOn(false);
                am.stopBluetoothSco();
            }
        }
        afterRoute(am);
        call.resolve(state(am));
    }

    /** speaker: the loudspeaker. Otherwise: a headset if one is connected, else the earpiece. */
    private void route(AudioManager am, boolean speaker) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            List<AudioDeviceInfo> devices = am.getAvailableCommunicationDevices();
            AudioDeviceInfo pick = null;
            if (speaker) {
                for (AudioDeviceInfo d : devices) if (d.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) pick = d;
            } else {
                for (AudioDeviceInfo d : devices) if (pick == null && isHeadset(d.getType())) pick = d;
                if (pick == null) for (AudioDeviceInfo d : devices) if (d.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) pick = d;
            }
            if (pick != null) am.setCommunicationDevice(pick);
        } else {
            am.setSpeakerphoneOn(speaker);
            // Wired headsets take the sound by themselves; Bluetooth ones need SCO turned on
            if (!speaker && hasBluetoothHeadset(am)) {
                am.startBluetoothSco();
                am.setBluetoothScoOn(true);
            } else if (am.isBluetoothScoOn()) {
                am.setBluetoothScoOn(false);
                am.stopBluetoothSco();
            }
        }
    }

    private boolean hasBluetoothHeadset(AudioManager am) {
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) if (d.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return true;
        return false;
    }

    /** Where the sound goes now: "headset", "earpiece" or "speaker". */
    private JSObject state(AudioManager am) {
        JSObject out = new JSObject();
        String route;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AudioDeviceInfo d = am.getCommunicationDevice();
            int t = d == null ? -1 : d.getType();
            route = t == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER ? "speaker" : isHeadset(t) ? "headset" : "earpiece";
            if (d != null) {
                out.put("id", String.valueOf(d.getId()));
                out.put("name", d.getProductName() == null ? "" : d.getProductName().toString());
                out.put("kind", kind(t));
            }
        } else {
            boolean wired = false;
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                if (d.getType() == AudioDeviceInfo.TYPE_WIRED_HEADSET || d.getType() == AudioDeviceInfo.TYPE_WIRED_HEADPHONES) wired = true;
            }
            route = am.isSpeakerphoneOn() ? "speaker" : am.isBluetoothScoOn() || wired ? "headset" : "earpiece";
        }
        out.put("route", route);
        out.put("speaker", route.equals("speaker"));
        return out;
    }
}
