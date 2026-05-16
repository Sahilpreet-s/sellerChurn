package api

import (
	"strings"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func SetupRouter(st *Store) *gin.Engine {
	r := gin.Default()

	r.Use(cors.New(cors.Config{
		AllowOriginFunc: func(origin string) bool {
			return strings.HasPrefix(origin, "http://localhost") ||
				strings.HasPrefix(origin, "http://127.0.0.1")
		},
		AllowMethods:     []string{"GET", "POST", "PUT", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		AllowCredentials: true,
	}))

	v1 := r.Group("/api/v1")
	{
		v1.GET("/sellers", st.ListSellers)
		v1.GET("/sellers/:id", st.GetSeller)
		v1.POST("/sellers/:id/outcome", st.LogOutcome)
		v1.POST("/sellers/:id/guide", st.GetRetentionGuide)

		v1.POST("/audio/upload", st.UploadAudio)

		v1.GET("/patterns", st.GetPatterns)
		v1.GET("/stats", st.GetStats)

		v1.GET("/playbook", st.GetPlaybook)
		v1.POST("/playbook/rebuild", st.RebuildPlaybook)

		v1.GET("/sellers/:id/agent", st.LiveAgentAnalysis)

		v1.GET("/ml/prediction/:id", st.GetMLPrediction)
		v1.GET("/ml/stats", st.GetMLStats)
		v1.POST("/ml/train", st.TriggerTraining)

		v1.POST("/batch/nightly", st.RunNightlyBatch)
	}

	return r
}
