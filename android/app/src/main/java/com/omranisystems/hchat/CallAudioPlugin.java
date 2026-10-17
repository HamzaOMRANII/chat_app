package com.omranisystems.hchat;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
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

    @PluginMethod
    public void start(PluginCall call) {
        AudioManager am = audio();
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        getActivity().runOnUiThread(() -> getActivity().setVolumeControlStream(AudioManager.STREAM_VOICE_CALL));
        route(am, Boolean.TRUE.equals(call.getBoolean("speaker", false)));
        call.resolve(state(am));
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        AudioManager am = audio();
        route(am, Boolean.TRUE.equals(call.getBoolean("on", false)));
        call.resolve(state(am));
    }

    @PluginMethod
    public void stop(PluginCall call) {
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
