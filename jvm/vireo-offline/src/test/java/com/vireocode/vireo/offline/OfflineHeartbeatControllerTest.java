package com.vireocode.vireo.offline;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

class OfflineHeartbeatControllerTest {

    @Test
    void streamDisablesIntermediaryBufferingAndCaching() {
        OfflineHeartbeatService heartbeatService = mock(OfflineHeartbeatService.class);
        SseEmitter emitter = new SseEmitter();
        when(heartbeatService.createEmitter()).thenReturn(emitter);
        OfflineHeartbeatController controller = new OfflineHeartbeatController(heartbeatService);
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThat(controller.stream(response)).isSameAs(emitter);
        assertThat(response.getHeader("X-Accel-Buffering")).isEqualTo("no");
        assertThat(response.getHeader("Cache-Control")).isEqualTo("no-cache");
        assertThat(response.getHeader("Connection")).isEqualTo("keep-alive");
    }
}
