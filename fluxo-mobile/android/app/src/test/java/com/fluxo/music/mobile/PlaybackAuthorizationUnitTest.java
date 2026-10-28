package com.fluxo.music.mobile;

import static org.junit.Assert.*;
import org.junit.Test;

public class PlaybackAuthorizationUnitTest {
    @Test public void startsWithoutPermissionToPlay() {
        assertFalse(new PlaybackAuthorization().allowed());
    }
    @Test public void explicitAuthorizationAllowsOnlyCurrentToken() {
        var policy = new PlaybackAuthorization();
        long old = policy.authorize(), current = policy.authorize();
        assertFalse(policy.allows(old)); assertTrue(policy.allows(current));
    }
    @Test public void losingFocusRevokesEveryOldCallback() {
        var policy = new PlaybackAuthorization();
        long token = policy.authorize(); policy.revoke();
        assertFalse(policy.allowed()); assertFalse(policy.allows(token));
    }
    @Test public void userResumeCannotValidateCallbackFromBeforeLoss() {
        var policy = new PlaybackAuthorization();
        long stale = policy.authorize(); policy.revoke(); long resumed = policy.authorize();
        assertFalse(policy.allows(stale)); assertTrue(policy.allows(resumed));
    }
}
