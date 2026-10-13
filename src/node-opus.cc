#include "napi.h"
#include "opus.h"
#include <cmath>
#include <climits>
#include <cstring>
#include <cstdint>
#include "node-opus.h"

using namespace Napi;

const char* getDecodeError(int decodedSamples) {
	switch(decodedSamples) {
		case OPUS_BAD_ARG:
			return "One or more invalid/out of range arguments";
		case OPUS_BUFFER_TOO_SMALL:
			return "The mode struct passed is invalid";
		case OPUS_INTERNAL_ERROR:
			return "An internal error was detected";
		case OPUS_INVALID_PACKET:
			return "The compressed data passed is corrupted";
		case OPUS_UNIMPLEMENTED:
			return "Invalid/unsupported request number";
		case OPUS_INVALID_STATE:
			return "An encoder or decoder structure is invalid or already freed.";
		case OPUS_ALLOC_FAIL:
			return "Memory allocation has failed";
		default:
			return "Unknown OPUS error";
	}
}

Object NodeOpusEncoder::Init(Napi::Env env, Object exports) {
	HandleScope scope(env);

	Function func = DefineClass(env, "OpusEncoder", {
		InstanceMethod("encode", &NodeOpusEncoder::Encode),
		InstanceMethod("decode", &NodeOpusEncoder::Decode),
		InstanceMethod("applyEncoderCTL", &NodeOpusEncoder::ApplyEncoderCTL),
		InstanceMethod("applyDecoderCTL", &NodeOpusEncoder::ApplyDecoderCTL),
		InstanceMethod("setBitrate", &NodeOpusEncoder::SetBitrate),
		InstanceMethod("getBitrate", &NodeOpusEncoder::GetBitrate),
	});

	exports.Set("OpusEncoder", func);
	return exports;
}

NodeOpusEncoder::NodeOpusEncoder(const CallbackInfo& args): ObjectWrap<NodeOpusEncoder>(args) {
	this->encoder = nullptr;
	this->decoder = nullptr;
	this->outPcm = nullptr;

	this->rate = 48000;
	this->channels = 2;

	if (args.Length() >= 1 && !args[0].IsUndefined()) {
		if (!args[0].IsNumber()) {
			Napi::TypeError::New(args.Env(), "Expected rate to be a number").ThrowAsJavaScriptException();
			return;
		}
		const double value = args[0].As<Number>().DoubleValue();
		if (!std::isfinite(value) || (value != 8000 && value != 12000 && value != 16000 && value != 24000 && value != 48000)) {
			Napi::RangeError::New(args.Env(), "Invalid Opus sample rate").ThrowAsJavaScriptException();
			return;
		}
		this->rate = static_cast<opus_int32>(value);
	}

	if (args.Length() >= 2 && !args[1].IsUndefined()) {
		if (!args[1].IsNumber()) {
			Napi::TypeError::New(args.Env(), "Expected channels to be a number").ThrowAsJavaScriptException();
			return;
		}
		const double value = args[1].As<Number>().DoubleValue();
		if (value != 1 && value != 2) {
			Napi::RangeError::New(args.Env(), "Expected one or two channels").ThrowAsJavaScriptException();
			return;
		}
		this->channels = static_cast<int>(value);
	}

	this->application = OPUS_APPLICATION_AUDIO;
	this->outPcm = new opus_int16[this->channels * MAX_FRAME_SIZE];
}

NodeOpusEncoder::~NodeOpusEncoder() {
	if (this->encoder) opus_encoder_destroy(this->encoder);
	if (this->decoder) opus_decoder_destroy(this->decoder);

	this->encoder = nullptr;
	this->decoder = nullptr;

	if (this->outPcm) delete[] this->outPcm;
	this->outPcm = nullptr;
}

int NodeOpusEncoder::EnsureEncoder() {
	if (this->encoder) return 0;

	int error;
	this->encoder = opus_encoder_create(rate, channels, application, &error);

	return error;
}

int NodeOpusEncoder::EnsureDecoder() {
	if (this->decoder) return 0;

	int error;
	this->decoder = opus_decoder_create(rate, channels, &error);

	return error;
}

Napi::Value NodeOpusEncoder::Encode(const CallbackInfo& args) {
	Napi::Env env = args.Env();

	if (this->EnsureEncoder() != OPUS_OK) {
		Napi::Error::New(env, "Could not create encoder. Check the encoder parameters").ThrowAsJavaScriptException();
		return env.Null();
	}

	if (args.Length() < 1) {
		Napi::RangeError::New(env, "Expected 1 argument").ThrowAsJavaScriptException();
		return env.Null();
	}

	if (!args[0].IsBuffer()) {
		Napi::TypeError::New(env, "Provided input needs to be a buffer").ThrowAsJavaScriptException();
		return env.Null();
	}

	Buffer<char> buf = args[0].As<Buffer<char>>();
	char* pcmData = buf.Data();
	opus_int16* pcm = reinterpret_cast<opus_int16*>(pcmData);
	if (buf.Length() == 0 || buf.Length() % (2 * this->channels) != 0 || buf.Length() > static_cast<size_t>(2 * this->channels * MAX_FRAME_SIZE)) {
        Napi::RangeError::New(env, "Invalid PCM frame length").ThrowAsJavaScriptException();
        return env.Null();
    }
    int frameSize = static_cast<int>(buf.Length() / 2 / this->channels);
    const bool validFrame = frameSize == rate / 400 || frameSize == rate / 200 || frameSize == rate / 100 || frameSize == rate / 50 || frameSize == rate / 25 || frameSize == 3 * rate / 50 || frameSize == 4 * rate / 50 || frameSize == rate / 10 || frameSize == 6 * rate / 50;
    if (!validFrame) {
        Napi::RangeError::New(env, "Invalid Opus frame duration").ThrowAsJavaScriptException();
        return env.Null();
    }
    if (reinterpret_cast<uintptr_t>(pcmData) % alignof(opus_int16) != 0) {
        alignedPcm.resize(buf.Length() / 2);
        std::memcpy(alignedPcm.data(), pcmData, buf.Length());
        pcm = alignedPcm.data();
    }

	int compressedLength = opus_encode(this->encoder, pcm, frameSize, &(this->outOpus[0]), MAX_PACKET_SIZE);

	if (compressedLength < 0) {
        Napi::Error::New(env, opus_strerror(compressedLength)).ThrowAsJavaScriptException();
        return env.Null();
    }
	Buffer<char> actualBuf = Buffer<char>::Copy(env, reinterpret_cast<char*>(this->outOpus), compressedLength);

	if (!actualBuf.IsEmpty()) return actualBuf;

	Napi::Error::New(env, "Could not encode the data").ThrowAsJavaScriptException();
	return env.Null();
}

Napi::Value NodeOpusEncoder::Decode(const CallbackInfo& args) {
	Napi::Env env = args.Env();

	if (args.Length() < 1) {
		Napi::RangeError::New(env, "Expected 1 argument").ThrowAsJavaScriptException();
		return env.Null();
	}

	if (!args[0].IsBuffer()) {
		Napi::TypeError::New(env, "Provided input needs to be a buffer").ThrowAsJavaScriptException();
		return env.Null();
	}

	Buffer<unsigned char> buf = args[0].As<Buffer<unsigned char>>();
	unsigned char* compressedData = buf.Data();
	if (buf.Length() > INT_MAX) {
        Napi::RangeError::New(env, "Opus packet is too large").ThrowAsJavaScriptException();
        return env.Null();
    }
    const opus_int32 compressedDataLength = static_cast<opus_int32>(buf.Length());

	if (this->EnsureDecoder() != OPUS_OK) {
		Napi::Error::New(env, "Could not create decoder. Check the decoder parameters").ThrowAsJavaScriptException();
		return env.Null();
	}

	int decodedSamples = opus_decode(
		this->decoder,
		compressedData,
		compressedDataLength,
		&(this->outPcm[0]),
		MAX_FRAME_SIZE,
		/* decode_fec */ 0
	);

	if (decodedSamples < 0) {
		Napi::TypeError::New(env, getDecodeError(decodedSamples)).ThrowAsJavaScriptException();
		return env.Null();
	}

	int decodedLength = decodedSamples * 2 * this->channels;

	Buffer<char> actualBuf = Buffer<char>::Copy(env, reinterpret_cast<char*>(this->outPcm), decodedLength);

	if (!actualBuf.IsEmpty()) return actualBuf;

	Napi::Error::New(env, "Could not decode the data").ThrowAsJavaScriptException();
	return env.Null();
}

void NodeOpusEncoder::ApplyEncoderCTL(const CallbackInfo& args) {
	Napi::Env env = args.Env();

	if (args.Length() < 2) {
		Napi::RangeError::New(env, "Expected 2 arguments").ThrowAsJavaScriptException();
		return;
	}

	if (!args[0].IsNumber() || !args[1].IsNumber()) {
		Napi::TypeError::New(env, "Expected ctl and value to be numbers").ThrowAsJavaScriptException();
		return;
	}

	int ctl = args[0].ToNumber().Int32Value();
	int value = args[1].ToNumber().Int32Value();

	if (this->EnsureEncoder() != OPUS_OK) {
		Napi::Error::New(env, "Could not create encoder. Check the encoder parameters").ThrowAsJavaScriptException();
		return;
	}

	if (opus_encoder_ctl(this->encoder, ctl, value) != OPUS_OK) {
		Napi::TypeError::New(env, "Invalid ctl / value").ThrowAsJavaScriptException();
		return;
	}
}

void NodeOpusEncoder::ApplyDecoderCTL(const CallbackInfo& args) {
	Napi::Env env = args.Env();

	if (args.Length() < 2) {
		Napi::RangeError::New(env, "Expected 2 arguments").ThrowAsJavaScriptException();
		return;
	}

	if (!args[0].IsNumber() || !args[1].IsNumber()) {
		Napi::TypeError::New(env, "Expected ctl and value to be numbers").ThrowAsJavaScriptException();
		return;
	}

	int ctl = args[0].ToNumber().Int32Value();
	int value = args[1].ToNumber().Int32Value();

	if (this->EnsureDecoder() != OPUS_OK) {
		Napi::Error::New(env, "Could not create decoder. Check the decoder parameters").ThrowAsJavaScriptException();
		return;
	}

	if (opus_decoder_ctl(this->decoder, ctl, value) != OPUS_OK) {
		Napi::TypeError::New(env, "Invalid ctl / value").ThrowAsJavaScriptException();
		return;
	}
}

void NodeOpusEncoder::SetBitrate(const CallbackInfo& args) {
	Napi::Env env = args.Env();

	if (args.Length() < 1) {
		Napi::RangeError::New(env, "Expected 1 argument").ThrowAsJavaScriptException();
		return;
	}

	if (!args[0].IsNumber()) {
		Napi::TypeError::New(env, "Expected bitrate to be a number").ThrowAsJavaScriptException();
		return;
	}

	int bitrate = args[0].ToNumber().Int32Value();

	if (this->EnsureEncoder() != OPUS_OK) {
		Napi::Error::New(env, "Could not create encoder. Check the encoder parameters").ThrowAsJavaScriptException();
		return;
	}

	if (opus_encoder_ctl(this->encoder, OPUS_SET_BITRATE(bitrate)) != OPUS_OK) {
		Napi::TypeError::New(env, "Invalid bitrate").ThrowAsJavaScriptException();
		return;
	}
}

Napi::Value NodeOpusEncoder::GetBitrate(const CallbackInfo& args) {
	Napi::Env env = args.Env();

	if (this->EnsureEncoder() != OPUS_OK) {
		Napi::Error::New(env, "Could not create encoder. Check the encoder parameters").ThrowAsJavaScriptException();
		return env.Null();
	}

	opus_int32 bitrate;
	opus_encoder_ctl(this->encoder, OPUS_GET_BITRATE(&bitrate));

	return Napi::Number::New(env, bitrate);
}

Object Init(Napi::Env env, Object exports) {
	exports.Set("getLibopusVersion", Function::New(env, [](const CallbackInfo& args) {
        return String::New(args.Env(), opus_get_version_string());
    }));
	return NodeOpusEncoder::Init(env, exports);
}

NODE_API_MODULE(opus, Init)
