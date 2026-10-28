package com.fluxo.music.mobile;

/** Automatic work belongs to one explicit playback intent, never to an old focus owner. */
final class PlaybackAuthorization {
    private long generation;
    private boolean allowed;
    long authorize() { allowed = true; return ++generation; }
    void revoke() { allowed = false; generation++; }
    boolean allows(long token) { return allowed && token == generation; }
    boolean allowed() { return allowed; }
    long generation() { return generation; }
}
