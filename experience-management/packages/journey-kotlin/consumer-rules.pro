# Public serializable protocol models retain their generated serializers.
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault,Signature
-if @kotlinx.serialization.Serializable class com.seemplify.journey.**
-keepclassmembers class <1> {
    static <1>$$serializer INSTANCE;
}

