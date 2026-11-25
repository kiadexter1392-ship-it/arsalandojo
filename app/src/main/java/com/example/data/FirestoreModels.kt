package com.example.data

import androidx.annotation.Keep
import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentId
import com.google.firebase.firestore.IgnoreExtraProperties
import com.google.firebase.firestore.ServerTimestamp

@Keep
@IgnoreExtraProperties
data class UserProfileDoc(
    @DocumentId val id: String = "",
    val userId: String = "",
    val displayName: String = "",
    val email: String = "",
    val photoUrl: String? = null,
    @ServerTimestamp val createdAt: Timestamp? = null,
    @ServerTimestamp val updatedAt: Timestamp? = null
)

enum class ProgressLogCategory(val raw: String) {
    WORKOUT("WORKOUT"),
    MILESTONE("MILESTONE");

    companion object {
        fun fromRaw(raw: String?): ProgressLogCategory =
            entries.firstOrNull { it.raw == raw } ?: WORKOUT
    }
}

data class NewProgressLogRequest(
    val category: ProgressLogCategory,
    val title: String,
    val durationMinutes: Int,
    val readinessScore: Int,
    val weightTenthsKg: Int,
    val sessionDateIso: String,
    val notes: String
)

@Keep
@IgnoreExtraProperties
data class WorkoutProgressLogDoc(
    @DocumentId val id: String = "",
    val userId: String = "",
    val category: String = ProgressLogCategory.WORKOUT.raw,
    val title: String = "",
    val durationMinutes: Long = 0L,
    val readinessScore: Long = 80L,
    val weightTenthsKg: Long = 0L,
    val sessionDateIso: String = "",
    val notes: String = "",
    @ServerTimestamp val createdAt: Timestamp? = null,
    @ServerTimestamp val updatedAt: Timestamp? = null
) {
    fun resolvedCategory(): ProgressLogCategory = ProgressLogCategory.fromRaw(category)

    fun weightKgOrNull(): Double? =
        if (weightTenthsKg in 200L..3000L) weightTenthsKg.toDouble() / 10.0 else null
}
