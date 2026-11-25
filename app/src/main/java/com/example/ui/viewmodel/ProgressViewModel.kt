package com.example.ui.viewmodel

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.data.DojoCloudRepository
import com.example.data.NewProgressLogRequest
import com.example.data.UserProfileDoc
import com.example.data.WorkoutProgressLogDoc
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestoreException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

sealed interface CloudProfileUiState {
    data object Loading : CloudProfileUiState
    data class Success(val profile: UserProfileDoc?) : CloudProfileUiState
    data class Error(val message: String) : CloudProfileUiState
}

sealed interface ProgressLogsUiState {
    data object Loading : ProgressLogsUiState
    data class Success(val logs: List<WorkoutProgressLogDoc>) : ProgressLogsUiState
    data class Error(val message: String) : ProgressLogsUiState
}

class ProgressViewModel(
    private val cloudRepository: DojoCloudRepository,
    private val currentUserId: String,
    connectivityFlow: Flow<Boolean>,
    initialConnected: Boolean,
    private val cloudLoadErrorMessage: String,
    private val progressSavedMessage: String,
    private val progressSaveErrorMessage: String
) : ViewModel() {

    private val _isSavingProgress = MutableStateFlow(false)
    val isSavingProgress: StateFlow<Boolean> = _isSavingProgress.asStateFlow()

    private val _errorEvents = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val errorEvents: SharedFlow<String> = _errorEvents.asSharedFlow()

    private val _infoEvents = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val infoEvents: SharedFlow<String> = _infoEvents.asSharedFlow()

    val isConnected: StateFlow<Boolean> = connectivityFlow
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = initialConnected
        )

    val userProfileState: StateFlow<CloudProfileUiState> = cloudRepository
        .observeUserProfile(currentUserId)
        .map<UserProfileDoc?, CloudProfileUiState> { CloudProfileUiState.Success(it) }
        .catch { error ->
            val firestoreError = generateSequence(error) { it.cause }
                .filterIsInstance<FirebaseFirestoreException>()
                .firstOrNull()
            if (firestoreError == null && error is CancellationException) throw error
            val rootError = firestoreError ?: error
            Log.w(TAG, "Error observing user profile", rootError)
            emit(CloudProfileUiState.Error(cloudLoadErrorMessage))
        }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = CloudProfileUiState.Loading
        )

    val progressLogsState: StateFlow<ProgressLogsUiState> = cloudRepository
        .observeProgressLogs(currentUserId)
        .map<List<WorkoutProgressLogDoc>, ProgressLogsUiState> { ProgressLogsUiState.Success(it) }
        .catch { error ->
            val firestoreError = generateSequence(error) { it.cause }
                .filterIsInstance<FirebaseFirestoreException>()
                .firstOrNull()
            if (firestoreError == null && error is CancellationException) throw error
            val rootError = firestoreError ?: error
            Log.w(TAG, "Error observing progress logs", rootError)
            emit(ProgressLogsUiState.Error(cloudLoadErrorMessage))
        }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = ProgressLogsUiState.Loading
        )

    init {
        syncUserIdentity()
    }

    private fun syncUserIdentity() {
        val currentUser = FirebaseAuth.getInstance().currentUser ?: return
        if (currentUser.uid != currentUserId) return
        viewModelScope.launch(Dispatchers.IO) {
            cloudRepository.syncSignedInUserProfile(currentUser)
        }
    }

    fun logWorkoutProgress(
        request: NewProgressLogRequest,
        onSaved: () -> Unit = {}
    ) {
        if (_isSavingProgress.value) return
        viewModelScope.launch {
            _isSavingProgress.value = true
            val result = cloudRepository.saveProgressLog(currentUserId, request)
            _isSavingProgress.value = false
            if (result.isSuccess) {
                _infoEvents.tryEmit(progressSavedMessage)
                onSaved()
            } else {
                _errorEvents.tryEmit(progressSaveErrorMessage)
            }
        }
    }

    private companion object {
        const val TAG = "ProgressVM"
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
