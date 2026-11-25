package com.example.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.example.R
import com.example.ui.theme.DojoGlassCardFrost
import com.example.ui.theme.DojoGreen
import com.example.ui.theme.DojoInk
import com.example.ui.theme.DojoMuted
import com.example.ui.theme.DojoPurpleBorderGlow
import com.example.ui.theme.DojoPurpleImperial

@Composable
fun CloudAccountStatusCard(
    displayName: String,
    email: String,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        color = DojoGlassCardFrost,
        border = BorderStroke(1.dp, DojoPurpleBorderGlow)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = DojoGreen.copy(alpha = 0.14f)
            ) {
                Icon(
                    imageVector = Icons.Default.CloudDone,
                    contentDescription = stringResource(R.string.auth_synced_badge),
                    tint = DojoGreen,
                    modifier = Modifier
                        .padding(8.dp)
                        .size(20.dp)
                )
            }

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = displayName.ifBlank { stringResource(R.string.auth_synced_badge) },
                    style = MaterialTheme.typography.titleSmall,
                    color = DojoInk,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = if (email.isNotBlank()) {
                        "$email • ${stringResource(R.string.auth_synced_badge)}"
                    } else {
                        stringResource(R.string.auth_synced_badge)
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = DojoMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }

            OutlinedButton(
                onClick = onSignOut,
                modifier = Modifier
                    .heightIn(min = 48.dp)
                    .testTag("cloud_sign_out_btn"),
                shape = RoundedCornerShape(12.dp),
                border = BorderStroke(1.dp, DojoPurpleBorderGlow)
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.Logout,
                    contentDescription = stringResource(R.string.auth_sign_out_btn),
                    tint = DojoPurpleImperial,
                    modifier = Modifier.size(16.dp)
                )
                Spacer(modifier = Modifier.size(5.dp))
                Text(
                    text = stringResource(R.string.logout_label),
                    style = MaterialTheme.typography.labelMedium,
                    color = DojoPurpleImperial
                )
            }
        }
    }
}
