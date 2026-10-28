package com.fluxo.music.mobile;

public final class PlaybackAuthorizationTest {
    private static int checks;
    private static void check(boolean condition) { checks++; if (!condition) throw new AssertionError("Authorization check " + checks); }
    public static void main(String[] args) {
        PlaybackAuthorization authorization = new PlaybackAuthorization();
        check(!authorization.allowed());
        long first = authorization.authorize(); check(authorization.allowed()); check(authorization.allows(first));
        authorization.revoke(); check(!authorization.allowed()); check(!authorization.allows(first));
        long second = authorization.authorize(); check(!authorization.allows(first)); check(authorization.allows(second));
        authorization.revoke(); check(!authorization.allows(second));
        System.out.println(checks + " playback authorization checks passed");
    }
}
